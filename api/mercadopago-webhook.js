const https = require('https');
const supabase = require('./supabase');

// Global Set to keep track of processed approved payment IDs in the current instance container
const processedPayments = new Set();

module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        console.log("Mercado Pago Webhook Raw Query:", req.query);
        console.log("Mercado Pago Webhook Raw Body Type:", typeof req.body);
        console.log("Mercado Pago Webhook Raw Body:", req.body);

        let body = req.body;
        if (body && (typeof body === 'string' || Buffer.isBuffer(body))) {
            const bodyStr = body.toString();
            try {
                body = JSON.parse(bodyStr);
            } catch (e) {
                const querystring = require('querystring');
                body = querystring.parse(bodyStr);
            }
        }

        // --- OMEGA PAYMENTS WEBHOOK HANDLER ---
        let omegaTxId = null;
        const potentialTx = body?.data || body || {};
        const queryParams = req.query || {};
        const candidateId = potentialTx.id || potentialTx.transactionId || body?.id || body?.transactionId || queryParams.id || queryParams.transactionId || queryParams.txId;
        const candidateClient = potentialTx.clientIdentifier || potentialTx.external_reference || body?.clientIdentifier || queryParams.clientIdentifier || queryParams.orderId;

        if (candidateId || candidateClient) {
            // Avoid matching Mercado Pago webhook payload (which has action/type/data.id)
            if (!body?.action && !body?.resource && !req.query.topic) {
                omegaTxId = candidateId || candidateClient;
            }
        }

        if (omegaTxId) {
            console.log(`Processing Omega Payments webhook for ID: ${omegaTxId}...`);
            if (processedPayments.has(omegaTxId)) {
                console.log(`Omega Payment ${omegaTxId} already processed in memory. Skipping.`);
                return res.status(200).json({ status: "skipped", reason: "already_processed_in_memory", omegaTxId });
            }

            try {
                const clientIdentifier = candidateClient || potentialTx.clientIdentifier || potentialTx.external_reference || body?.clientIdentifier;
                
                // Step 1: Check if the PAYLOAD itself already says COMPLETED/APPROVED (trust payload first)
                const payloadStatus = potentialTx.status || body?.status || '';
                const payloadIsCompleted = ['APPROVED', 'PAID', 'SUCCESS', 'CONFIRMED', 'COMPLETED'].includes(payloadStatus.toUpperCase());
                
                let rawStatus = payloadIsCompleted ? payloadStatus : 'PENDING';
                let orderId = clientIdentifier || potentialTx.clientIdentifier;
                let verifiedTx = null;

                console.log(`Webhook payload status: "${payloadStatus}", clientIdentifier: "${clientIdentifier}", payloadIsCompleted: ${payloadIsCompleted}`);

                // Step 2: Only re-query Omega API if payload is ambiguous/empty — to avoid their cache bug
                if (!payloadIsCompleted) {
                    console.log(`Payload status is not completed. Re-querying Omega Payments to verify...`);
                    if (clientIdentifier) {
                        try {
                            verifiedTx = await getOmegaTransactionVerified(`clientIdentifier=${encodeURIComponent(clientIdentifier)}`);
                            rawStatus = verifiedTx?.status || 'PENDING';
                            orderId = verifiedTx?.clientIdentifier || orderId;
                        } catch (e) {
                            console.error("Error verifying by clientIdentifier:", e.message);
                        }
                    }
                    // Fallback by ID if still not completed
                    if (!['APPROVED', 'PAID', 'SUCCESS', 'CONFIRMED', 'COMPLETED'].includes(rawStatus.toUpperCase())) {
                        try {
                            const verifiedTxById = await getOmegaTransactionVerified(`id=${encodeURIComponent(omegaTxId)}`);
                            if (verifiedTxById && ['APPROVED', 'PAID', 'SUCCESS', 'CONFIRMED', 'COMPLETED'].includes((verifiedTxById.status || '').toUpperCase())) {
                                verifiedTx = verifiedTxById;
                                rawStatus = verifiedTxById.status;
                                orderId = verifiedTxById.clientIdentifier || orderId;
                            }
                        } catch (e) {
                            console.error("Error verifying by id:", e.message);
                        }
                    }
                } else {
                    // Payload says completed — use payload data directly, fetch tx only for enrichment
                    console.log(`Trusting webhook payload status: ${payloadStatus}. Enriching with Omega API data...`);
                    if (clientIdentifier) {
                        try {
                            verifiedTx = await getOmegaTransactionVerified(`clientIdentifier=${encodeURIComponent(clientIdentifier)}`);
                            orderId = verifiedTx?.clientIdentifier || orderId;
                            // Don't override rawStatus from payload — trust payload
                        } catch (e) {
                            console.error("Error enriching by clientIdentifier (non-critical):", e.message);
                        }
                    }
                    if (!orderId) {
                        try {
                            const txById = await getOmegaTransactionVerified(`id=${encodeURIComponent(omegaTxId)}`);
                            orderId = txById?.clientIdentifier || orderId;
                        } catch (e) {
                            console.error("Error enriching by id (non-critical):", e.message);
                        }
                    }
                }

                console.log(`Final status for ID ${omegaTxId}: ${rawStatus}, resolved orderId: ${orderId}`);

                if (['APPROVED', 'PAID', 'SUCCESS', 'CONFIRMED', 'COMPLETED'].includes(rawStatus.toUpperCase())) {
                    if (!orderId) {
                        console.error(`Could not resolve orderId/clientIdentifier for Omega payment ${omegaTxId}`);
                        return res.status(200).json({ status: "failed", reason: "could_not_resolve_order_id", omegaTxId });
                    }

                    // Update database
                    const updateRes = await supabase.updateOrderIfPending(orderId, { payment_status: 'approved' });
                    if (Array.isArray(updateRes) && updateRes.length === 0) {
                        console.log(`Order ${orderId} (Omega Payment ${omegaTxId}) was ALREADY processed. Skipping duplicate triggers.`);
                        return res.status(200).json({ status: "skipped", reason: "order_already_processed_in_db", orderId, omegaTxId });
                    }

                    processedPayments.add(omegaTxId);

                    // Fetch full order to trigger correct emails/Brevo lists with exact customer information
                    let clientEmail = "";
                    let clientName = "Devoto";
                    let cleanPhone = "";
                    let donationAmount = parseFloat(verifiedTx.amount || 60.00);

                    try {
                        const order = await supabase.getOrderById(orderId);
                        if (order) {
                            clientEmail = order.donor_email || "";
                            clientName = order.donor_name || "Devoto";
                            cleanPhone = order.donor_phone || "";
                            donationAmount = parseFloat(order.donation_amount || verifiedTx.amount || 60.00);
                        }
                    } catch (dbErr) {
                        console.error("Database lookup error in webhook:", dbErr.message);
                    }

                    // Construct compatibility object
                    const paymentData = {
                        id: omegaTxId,
                        status: 'approved',
                        transaction_amount: donationAmount,
                        metadata: {
                            order_id: orderId,
                            payer_email: clientEmail,
                            payer_name: clientName,
                            payer_phone: cleanPhone
                        },
                        external_reference: orderId,
                        payer: {
                            email: clientEmail,
                            first_name: clientName.split(' ')[0] || "Devoto",
                            last_name: clientName.split(' ').slice(1).join(' ') || ""
                        }
                    };

                    try {
                        const triggers = [
                            triggerPushcutApprovedByAmount(donationAmount),
                            triggerLaillaApproved(paymentData),
                            removeContactFromBrevoList(clientEmail, 8)
                        ];
                        
                        let targetListId = null;
                        if (Math.abs(donationAmount - 50.00) < 0.01 || Math.abs(donationAmount - 60.00) < 0.01) {
                            targetListId = 12; // "Compra Aprovada - R$ 50/60 reais"
                        } else if (Math.abs(donationAmount - 10.00) < 0.01 || 
                                   Math.abs(donationAmount - 15.00) < 0.01 || 
                                   Math.abs(donationAmount - 20.00) < 0.01) {
                            targetListId = 5;  // "Compras Aprovadas" (R$ 10, 15, 20)
                        }

                        if (targetListId && clientEmail) {
                            triggers.push(addContactToBrevoList(clientEmail, clientName, cleanPhone, targetListId));
                        }

                        if (process.env.ENABLE_BREVO_EMAILS === 'true' && clientEmail) {
                            triggers.push(sendBrevoApprovedEmail(paymentData));
                        }

                        await Promise.allSettled(triggers);
                    } catch (webhookErr) {
                        console.error("Error in webhook parallel triggers:", webhookErr.message);
                    }
                } else {
                    console.log(`Omega Payment status is ${rawStatus}, not approved. Skipping.`);
                }
            } catch (err) {
                console.error(`Error processing Omega webhook verification for ${omegaTxId}:`, err.message);
            }

            return res.status(200).json({ status: "success", omegaTxId });
        }

        // Try extracting ID and Topic/Type from all possible locations
        let resourceId = req.query.id || 
                         req.query['data.id'] || 
                         (req.query.data && req.query.data.id) ||
                         req.query['data[id]'] ||
                         (body && body.data && body.data.id) || 
                         (body && body.id) ||
                         (body && body['data.id']) ||
                         (body && body['data[id]']);

        let topic = req.query.topic || 
                    req.query.type || 
                    req.query['type'] || 
                    (body && body.type) || 
                    (body && body.topic) ||
                    'payment';

        console.log("Extracted Resource ID:", resourceId);
        console.log("Extracted Topic/Type:", topic);

        if (resourceId) {
            // Skip merchant_order topic to prevent double trigger
            if (topic === 'merchant_order' || topic === 'merchant-order') {
                console.log(`Skipping merchant_order ${resourceId} to prevent duplicate triggers`);
                return res.status(200).send("OK");
            }

            const primaryToken = process.env.MERCADO_PAGO_ACCESS_TOKEN || "APP_USR-6237078041440230-070300-0a8d02fca8b811f32ec1ddb51f27090e-136413525";
            const secondaryToken = "APP_USR-8992204038760430-071022-0017efee923c2d2d7c482f2a4b0d4bde-3535669114";

            const fetchPayment = (resourceId, token) => {
                return new Promise((resolve) => {
                    const options = {
                        hostname: 'api.mercadopago.com',
                        port: 443,
                        path: `/v1/payments/${resourceId}`,
                        method: 'GET',
                        headers: {
                            'Authorization': `Bearer ${token}`
                        }
                    };

                    const getReq = https.request(options, (getRes) => {
                        let data = '';
                        getRes.on('data', (chunk) => data += chunk);
                        getRes.on('end', () => {
                            if (getRes.statusCode >= 200 && getRes.statusCode < 300) {
                                try {
                                    resolve(JSON.parse(data));
                                } catch (e) {
                                    resolve(null);
                                }
                            } else {
                                resolve(null);
                            }
                        });
                    });

                    getReq.on('error', () => {
                        resolve(null);
                    });

                    getReq.end();
                });
            };

            // Query payment API with primary token first, fallback to secondary token
            console.log(`Querying payment ${resourceId} with primary token...`);
            let paymentData = await fetchPayment(resourceId, primaryToken);
            if (!paymentData) {
                console.log("Querying payment " + resourceId + " with secondary token fallback...");
                paymentData = await fetchPayment(resourceId, secondaryToken);
            }

            if (paymentData) {
                console.log(`Payment Status for ID ${resourceId}:`, paymentData.status);
                
                if (paymentData.status === 'approved') {
                    // Memory check for current container
                    if (processedPayments.has(resourceId)) {
                        console.log(`Payment ${resourceId} already processed in memory. Skipping.`);
                        return res.status(200).send("OK");
                    }

                    const orderId = paymentData.metadata?.order_id || paymentData.external_reference;
                    if (orderId) {
                        const updateRes = await supabase.updateOrderIfPending(orderId, { payment_status: 'approved' });
                        if (Array.isArray(updateRes) && updateRes.length === 0) {
                            console.log(`Order ${orderId} (Payment ${resourceId}) was ALREADY processed as approved in database. Skipping duplicate Pushcut triggers.`);
                            return res.status(200).send("OK");
                        }
                    }

                    processedPayments.add(resourceId);

                    // Extract contact info
                    let recipientEmail = (paymentData.metadata && paymentData.metadata.payer_email) || paymentData.payer?.email;
                    if (recipientEmail && (!recipientEmail.includes('@') || recipientEmail.includes('XXX'))) {
                        recipientEmail = (paymentData.metadata && paymentData.metadata.payer_email) || "";
                    }
                    const recipientName = (paymentData.metadata && paymentData.metadata.payer_name) || `${paymentData.payer?.first_name || ""} ${paymentData.payer?.last_name || ""}`.trim() || "Devoto";
                    
                    let cleanPhone = "";
                    if (paymentData.metadata && paymentData.metadata.payer_phone) {
                        cleanPhone = paymentData.metadata.payer_phone;
                    } else if (paymentData.payer && paymentData.payer.phone) {
                        const areaCode = paymentData.payer.phone.area_code || "";
                        const number = paymentData.payer.phone.number || "";
                        cleanPhone = (areaCode + number).replace(/\D/g, '');
                        if (cleanPhone && !cleanPhone.startsWith('55') && (cleanPhone.length === 10 || cleanPhone.length === 11)) {
                            cleanPhone = '55' + cleanPhone;
                        }
                    }
                    if (cleanPhone && !cleanPhone.startsWith('+')) {
                        cleanPhone = '+' + cleanPhone;
                    }

                    // Trigger conversion webhooks in parallel (much faster, resolves timeout issues)
                    try {
                        const triggers = [
                            triggerPushcutApprovedByAmount(paymentData.transaction_amount),
                            triggerLaillaApproved(paymentData),
                            removeContactFromBrevoList(recipientEmail, 8)
                        ];
                        
                        const donationAmount = parseFloat(paymentData.transaction_amount || 0);
                        let targetListId = null;
                        if (Math.abs(donationAmount - 50.00) < 0.01 || Math.abs(donationAmount - 60.00) < 0.01) {
                            targetListId = 12; // "Compras Aprovadas" (R$ 50/60)
                        } else if (Math.abs(donationAmount - 10.00) < 0.01 || 
                                   Math.abs(donationAmount - 15.00) < 0.01 || 
                                   Math.abs(donationAmount - 20.00) < 0.01) {
                            targetListId = 5;  // "Compras Aprovadas" (R$ 10, 15, 20)
                        }

                        if (targetListId) {
                            triggers.push(addContactToBrevoList(recipientEmail, recipientName, cleanPhone, targetListId));
                        }

                        if (process.env.ENABLE_BREVO_EMAILS === 'true') {
                            triggers.push(sendBrevoApprovedEmail(paymentData));
                        }

                        await Promise.allSettled(triggers);
                    } catch (webhookErr) {
                        console.error("Error in webhook parallel triggers:", webhookErr.message);
                    }
                } else {
                    console.log(`Payment status is ${paymentData.status}, not approved. Skipping.`);
                }
            } else {
                console.error(`Failed to fetch payment details for ID ${resourceId} with both tokens.`);
            }
        } else {
            console.log("No resource ID found in webhook payload. Skipping check.");
        }

        return res.status(200).send("OK");

    } catch (error) {
        console.error("Webhook processing error:", error.message);
        return res.status(200).send("OK");
    }
};

function triggerPushcutApprovedByAmount(amount) {
    return new Promise((resolve) => {
        const roundedAmount = Math.round(amount);
        let pushcutUrl = "";
        
        if (roundedAmount === 10) {
            pushcutUrl = "https://api.pushcut.io/K1TZkL2GM2OjtKHRpac5Y/notifications/Pix%20Pago%20-%2010";
        } else if (roundedAmount === 15) {
            pushcutUrl = "https://api.pushcut.io/K1TZkL2GM2OjtKHRpac5Y/notifications/Pix%20Pago%20-%2015";
        } else if (roundedAmount === 20) {
            pushcutUrl = "https://api.pushcut.io/K1TZkL2GM2OjtKHRpac5Y/notifications/Pix%20Pago%20-%2020";
        } else if (roundedAmount === 50 || roundedAmount === 60) {
            pushcutUrl = "https://api.pushcut.io/K1TZkL2GM2OjtKHRpac5Y/notifications/Pix%20Pago%20-%2050";
        } else {
            console.log(`Unknown amount ${roundedAmount} for Pushcut approved. Skipping.`);
            return resolve();
        }

        const url = require('url');
        const parsedUrl = url.parse(pushcutUrl);
        
        const options = {
            hostname: parsedUrl.hostname,
            port: 443,
            path: parsedUrl.path,
            method: 'POST',
            headers: {
                'Content-Length': '0'
            }
        };

        const req = https.request(options, (res) => {
            let resData = '';
            res.on('data', (chunk) => resData += chunk);
            res.on('end', () => {
                console.log(`Pushcut Approved notification (${roundedAmount}) sent. Response:`, resData);
                resolve();
            });
        });

        req.on('error', (e) => {
            console.error(`Pushcut Approved notification (${roundedAmount}) trigger failed:`, e.message);
            resolve();
        });

        req.end();
    });
}

function triggerLaillaApproved(paymentData) {
    return new Promise((resolve) => {
        const laillaUrl = "https://api.lailla.io/v1/webhook/custom/16de6a1b-fc22-48ee-a6da-8517fd640d40";

        let cleanPhone = "";
        if (paymentData.metadata && paymentData.metadata.payer_phone) {
            cleanPhone = paymentData.metadata.payer_phone;
        } else if (paymentData.payer && paymentData.payer.phone) {
            const areaCode = paymentData.payer.phone.area_code || "";
            const number = paymentData.payer.phone.number || "";
            cleanPhone = (areaCode + number).replace(/\D/g, '');
            if (cleanPhone && !cleanPhone.startsWith('55') && (cleanPhone.length === 10 || cleanPhone.length === 11)) {
                cleanPhone = '55' + cleanPhone;
            }
        }
        if (cleanPhone && !cleanPhone.startsWith('+')) {
            cleanPhone = '+' + cleanPhone;
        }

        const payload = {
            event: "order.approved",
            phone: cleanPhone,
            name: `${paymentData.payer?.first_name || ""} ${paymentData.payer?.last_name || ""}`.trim() || "Devoto",
            email: paymentData.payer?.email || "",
            order: {
                id: paymentData.id ? `MP-${paymentData.id}` : `SR-${Math.floor(Math.random() * 900000 + 100000)}-BR`,
                status: "approved",
                payment_method: paymentData.payment_method_id || "pix",
                amount: parseFloat(paymentData.transaction_amount || 0),
                product: "Camisa Devocional de Nossa Senhora Aparecida"
            },
            customer: {
                name: `${paymentData.payer?.first_name || ""} ${paymentData.payer?.last_name || ""}`.trim() || "Devoto",
                email: paymentData.payer?.email || "",
                phone: cleanPhone
            }
        };

        const payloadStr = JSON.stringify(payload);

        const url = require('url');
        const parsedUrl = url.parse(laillaUrl);

        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            path: parsedUrl.path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payloadStr)
            }
        };

        const client = parsedUrl.protocol === 'https:' ? require('https') : require('http');

        const req = client.request(options, (res) => {
            let resData = '';
            res.on('data', (c) => resData += c);
            res.on('end', () => {
                console.log("Lailla Approved Webhook Response:", res.statusCode, resData);
                resolve();
            });
        });

        req.on('error', (e) => {
            console.error("Lailla Approved Webhook Error:", e.message);
            resolve();
        });

        req.write(payloadStr);
        req.end();
    });
}

function sendBrevoApprovedEmail(paymentData) {
    return new Promise((resolve) => {
        const apiKey = process.env.BREVO_API_KEY;
        const senderEmail = "contato@maesantissima.com";
        let recipientEmail = (paymentData.metadata && paymentData.metadata.payer_email) || paymentData.payer?.email;
        if (recipientEmail && (!recipientEmail.includes('@') || recipientEmail.includes('XXX'))) {
            recipientEmail = (paymentData.metadata && paymentData.metadata.payer_email) || "";
        }
        const recipientName = (paymentData.metadata && paymentData.metadata.payer_name) || `${paymentData.payer?.first_name || ""} ${paymentData.payer?.last_name || ""}`.trim() || "Devoto";
        const amount = parseFloat(paymentData.transaction_amount || 0);
        const formattedAmount = amount.toFixed(2).replace('.', ',');
        const orderId = paymentData.id ? `MP-${paymentData.id}` : `SR-${Date.now()}-BR`;

        const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Doação Confirmada</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f7f9fa; color: #334155; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
        .content { padding: 30px 24px; }
        .greeting { font-size: 18px; font-weight: 700; color: #061930; margin-top: 0; margin-bottom: 12px; }
        .intro-text { font-size: 14px; line-height: 1.6; color: #475569; margin-bottom: 24px; }
        .summary-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px; }
        .summary-table th, .summary-table td { padding: 10px; border-bottom: 1px solid #e2e8f0; text-align: left; }
        .summary-table th { color: #475569; font-weight: 700; }
        .summary-table td { color: #061930; font-weight: 800; }
        .footer { background-color: #f1f5f9; padding: 20px; text-align: center; font-size: 11px; color: #94a3b8; line-height: 1.4; border-top: 1px solid #e2e8f0; }
    </style>
</head>
<body>
    <div class="container">
        <div style="text-align: center; background-color: #061930; border-bottom: 3px solid #d4af37;">
            <img src="https://maesantissima.com/assets/email_banner_v2.png" width="600" style="width: 100%; max-width: 600px; display: block; height: auto;" alt="Mãe Santíssima" />
        </div>
        <div class="content">
            <h2 class="greeting" style="color: #16a34a; font-weight: 800; font-size: 20px; display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 24px;">✓</span> Pagamento Confirmado!
            </h2>
            <p class="intro-text">Olá, <strong>${recipientName}</strong>! Sua doação foi confirmada com sucesso! Muito obrigado pelo seu gesto de amor e generosidade em apoiar a nossa campanha e ajudar a propagar a devoção à Nossa Senhora Aparecida. 💛</p>
            
            <table class="summary-table">
                <tr>
                    <th>Código do Pedido</th>
                    <td>${orderId}</td>
                </tr>
                <tr>
                    <th>Item</th>
                    <td>Camisa Devocional de Nossa Senhora Aparecida (Grátis)</td>
                </tr>
                <tr>
                    <th>Doação</th>
                    <td>R$ ${formattedAmount}</td>
                </tr>
                <tr>
                    <th>Status do Pagamento</th>
                    <td style="color: #16a34a; font-weight: bold;">🟢 Aprovado / Pago</td>
                </tr>
            </table>

            <p class="intro-text" style="font-size: 12px; margin-bottom: 0; line-height: 1.6; color: #475569;">Caso sua participação contemple o envio da Camisa Devocional de Nossa Senhora Aparecida, o pedido será registrado em nossa distribuidora. O prazo para postagem é de até 10 dias úteis. Após a postagem, o prazo estimado de entrega pelos Correios é de até 7 dias úteis, podendo variar conforme a região. Assim que a encomenda for postada, o código de rastreamento será enviado para o seu e-mail, para que você possa acompanhar todo o processo de entrega.</p>
        </div>
        <div class="footer">
            <p>© 2026 Mãe Santíssima. Todos os direitos reservados.</p>
            <p>Este é um e-mail automático. Por favor, não responda diretamente.</p>
        </div>
    </div>
</body>
</html>
        `;

        const payload = {
            sender: { name: "Mãe Santíssima", email: senderEmail },
            to: [{ email: recipientEmail, name: recipientName }],
            subject: "Doação Confirmada! Muito obrigado pelo seu apoio 🙏",
            htmlContent: htmlContent
        };

        const payloadStr = JSON.stringify(payload);

        const options = {
            hostname: 'api.brevo.com',
            port: 443,
            path: '/v3/smtp/email',
            method: 'POST',
            headers: {
                'api-key': apiKey,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payloadStr)
            }
        };

        const req = https.request(options, (res) => {
            let resData = '';
            res.on('data', (c) => resData += c);
            res.on('end', () => {
                console.log("Brevo Approved Email Response status:", res.statusCode);
                resolve();
            });
        });

        req.on('error', (e) => {
            console.error("Brevo Approved Email Error:", e.message);
            resolve();
        });

        req.write(payloadStr);
        req.end();
    });
}

function addContactToBrevoList(email, name, phone, listId) {
    return new Promise((resolve) => {
        const apiKey = process.env.BREVO_API_KEY;
        if (!apiKey) {
            console.error("Missing BREVO_API_KEY for adding contact to list");
            return resolve();
        }

        if (!email) {
            console.error("Missing email for adding contact to list");
            return resolve();
        }

        const nameParts = (name || "").trim().split(/\s+/);
        const firstName = nameParts[0] || "Devoto";
        const lastName = nameParts.slice(1).join(" ") || "";

        // Format phone: remove all non-digits, ensure country code 55 if Brazilian
        let cleanPhone = (phone || "").replace(/\D/g, '');
        if (cleanPhone && !cleanPhone.startsWith('55') && (cleanPhone.length === 10 || cleanPhone.length === 11)) {
            cleanPhone = '55' + cleanPhone;
        }

        const payload = {
            email: email,
            attributes: {
                NOME: firstName,
                SOBRENOME: lastName
            },
            listIds: [listId],
            updateEnabled: true
        };

        if (cleanPhone) {
            payload.attributes.SMS = cleanPhone;
        }

        const payloadStr = JSON.stringify(payload);

        const options = {
            hostname: 'api.brevo.com',
            port: 443,
            path: '/v3/contacts',
            method: 'POST',
            headers: {
                'api-key': apiKey,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payloadStr)
            }
        };

        const req = https.request(options, (res) => {
            let resData = '';
            res.on('data', (c) => resData += c);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    console.log(`Brevo Add Contact list status: ${res.statusCode}. Response: ${resData}`);
                    resolve();
                } else {
                    console.error(`Brevo Add Contact list failed with status: ${res.statusCode}. Response: ${resData}`);
                    if (payload.attributes && payload.attributes.SMS) {
                        console.log(`Retrying Brevo Add Contact without SMS attribute...`);
                        const retryPayload = { ...payload };
                        retryPayload.attributes = { ...payload.attributes };
                        delete retryPayload.attributes.SMS;
                        
                        const retryPayloadStr = JSON.stringify(retryPayload);
                        const retryOptions = {
                            ...options,
                            headers: {
                                ...options.headers,
                                'Content-Length': Buffer.byteLength(retryPayloadStr)
                            }
                        };
                        const retryReq = https.request(retryOptions, (retryRes) => {
                            let retryResData = '';
                            retryRes.on('data', (c) => retryResData += c);
                            retryRes.on('end', () => {
                                console.log(`Brevo Retry Add Contact status: ${retryRes.statusCode}. Response: ${retryResData}`);
                                resolve();
                            });
                        });
                        retryReq.on('error', (re) => {
                            console.error(`Brevo Retry Add Contact error:`, re.message);
                            resolve();
                        });
                        retryReq.write(retryPayloadStr);
                        retryReq.end();
                    } else {
                        resolve();
                    }
                }
            });
        });

        req.on('error', (e) => {
            console.error("Brevo Add Contact list error:", e.message);
            resolve();
        });

        req.write(payloadStr);
        req.end();
    });
}

function removeContactFromBrevoList(email, listId) {
    return new Promise((resolve) => {
        const apiKey = process.env.BREVO_API_KEY;
        if (!apiKey || !email) return resolve();

        const payload = {
            emails: [email]
        };
        const payloadStr = JSON.stringify(payload);

        const options = {
            hostname: 'api.brevo.com',
            port: 443,
            path: `/v3/contacts/lists/${listId}/contacts/remove`,
            method: 'POST',
            headers: {
                'api-key': apiKey,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payloadStr)
            }
        };

        const req = https.request(options, (res) => {
            let resData = '';
            res.on('data', (c) => resData += c);
            res.on('end', () => {
                console.log(`Brevo Remove Contact from list ${listId} status: ${res.statusCode}. Response: ${resData}`);
                resolve();
            });
        });

        req.on('error', (e) => {
            console.error(`Brevo Remove Contact from list ${listId} error:`, e.message);
            resolve();
        });

        req.write(payloadStr);
        req.end();
    });
}

function getOmegaTransactionVerified(queryParam) {
    return new Promise((resolve, reject) => {
        const publicKey = process.env.OMEGA_PUBLIC_KEY || "startplataforma_hd2un77uamc15j81";
        const secretKey = process.env.OMEGA_SECRET_KEY || "8paa692vn728sr39p50p8dl3bzlyxcrhn1kg2hx0t3z0x2fhc5tkaq7230vyl2t9";

        const req = https.request({
            hostname: 'app.omegapayments.com.br',
            port: 443,
            path: `/api/v1/gateway/transactions?${queryParam}`,
            method: 'GET',
            headers: {
                'x-public-key': publicKey,
                'x-secret-key': secretKey,
                'User-Agent': 'Mozilla/5.0'
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(parsed);
                    } else {
                        reject(new Error(`Failed to query Omega transaction: ${res.statusCode} - ${data}`));
                    }
                } catch (e) {
                    reject(e);
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
}
