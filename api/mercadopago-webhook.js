const https = require('https');

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
            // Skip merchant_order topic to prevent double trigger (we rely exclusively on the direct payment topic)
            if (topic === 'merchant_order' || topic === 'merchant-order') {
                console.log(`Skipping merchant_order ${resourceId} to prevent duplicate triggers`);
                return res.status(200).send("OK");
            }

            const newToken = "APP_USR-8992204038760430-071022-0017efee923c2d2d7c482f2a4b0d4bde-3535669114";
            const oldToken = process.env.MERCADO_PAGO_ACCESS_TOKEN || "APP_USR-6237078041440230-070300-0a8d02fca8b811f32ec1ddb51f27090e-136413525";

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

            // Query payment API with new token first, fallback to old token
            console.log(`Querying payment ${resourceId} with new token...`);
            let paymentData = await fetchPayment(resourceId, newToken);
            if (!paymentData) {
                console.log("Querying payment " + resourceId + " with old token fallback...");
                paymentData = await fetchPayment(resourceId, oldToken);
            }

            if (paymentData) {
                console.log(`Payment Status for ID ${resourceId}:`, paymentData.status);
                
                if (paymentData.status === 'approved') {
                    // Double check if we've already triggered for this ID
                    if (processedPayments.has(resourceId)) {
                        console.log(`Payment ${resourceId} already processed as approved in this instance container. Skipping duplicate triggers.`);
                    } else {
                        processedPayments.add(resourceId);

                        // Trigger conversion webhooks in parallel (much faster, resolves timeout issues)
                        try {
                            const triggers = [
                                triggerPushcutApprovedByAmount(paymentData.transaction_amount),
                                triggerLaillaApproved(paymentData)
                            ];
                            if (process.env.ENABLE_BREVO_EMAILS === 'true') {
                                triggers.push(sendBrevoApprovedEmail(paymentData));
                            }
                            await Promise.allSettled(triggers);
                        } catch (webhookErr) {
                            console.error("Error in webhook parallel triggers:", webhookErr.message);
                        }
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

        res.status(200).send("OK");

    } catch (error) {
        console.error("Webhook processing error:", error.message);
        res.status(200).send("OK");
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
        } else if (roundedAmount === 50) {
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
            <p>© 2026 Associação Mãe Santíssima. Todos os direitos reservados.</p>
            <p>Este é um e-mail automático. Por favor, não responda diretamente.</p>
        </div>
    </div>
</body>
</html>
        `;

        const payload = {
            sender: { name: "Associação Mãe Santíssima", email: senderEmail },
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
