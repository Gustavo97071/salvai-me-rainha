const https = require('https');
const url = require('url');
const supabase = require('./supabase');

function triggerPushcutApprovedByAmount(amount) {
    return new Promise((resolve) => {
        let numAmount = parseFloat(amount || 0);
        if (numAmount > 100) {
            numAmount = numAmount / 100;
        }
        const roundedAmount = Math.round(numAmount);
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
            pushcutUrl = "https://api.pushcut.io/K1TZkL2GM2OjtKHRpac5Y/notifications/Pix%20Pago%20-%2010";
        }

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
            shipping: {
                address: paymentData.metadata?.shipping_address || "",
                city: paymentData.metadata?.shipping_city || "",
                state: paymentData.metadata?.shipping_state || "",
                zip_code: paymentData.metadata?.shipping_zip || ""
            }
        };

        const payloadStr = JSON.stringify(payload);
        const parsedUrl = url.parse(laillaUrl);

        const options = {
            hostname: parsedUrl.hostname,
            port: 443,
            path: parsedUrl.path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payloadStr)
            }
        };

        const req = https.request(options, (res) => {
            let resData = '';
            res.on('data', (c) => resData += c);
            res.on('end', () => {
                console.log("Lailla Approved Webhook Response status:", res.statusCode);
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

function removeContactFromBrevoList(email, listId) {
    return new Promise((resolve) => {
        const apiKey = process.env.BREVO_API_KEY;
        if (!apiKey || !email) return resolve();

        const payload = { emails: [email] };
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
                console.log(`Brevo Remove Contact (${email}) from list ${listId} status: ${res.statusCode}`);
                resolve();
            });
        });

        req.on('error', (e) => {
            console.error(`Brevo Remove Contact Error:`, e.message);
            resolve();
        });

        req.write(payloadStr);
        req.end();
    });
}

function addContactToBrevoList(email, name, phone, listId) {
    return new Promise((resolve) => {
        const apiKey = process.env.BREVO_API_KEY;
        if (!apiKey || !email) return resolve();

        const nameParts = (name || "").trim().split(/\s+/);
        const firstName = nameParts[0] || "Devoto";
        const lastName = nameParts.slice(1).join(" ") || "";

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
                console.log(`Brevo Add Contact (${email}) to list ${listId} status: ${res.statusCode}`);
                resolve();
            });
        });

        req.on('error', (e) => {
            console.error(`Brevo Add Contact Error:`, e.message);
            resolve();
        });

        req.write(payloadStr);
        req.end();
    });
}

function sendBrevoApprovedEmail(paymentData) {
    return new Promise((resolve) => {
        const apiKey = process.env.BREVO_API_KEY;
        if (!apiKey) return resolve();

        const senderEmail = "contato@maesantissima.com";
        let recipientEmail = (paymentData.metadata && paymentData.metadata.payer_email) || paymentData.payer?.email;
        if (recipientEmail && (!recipientEmail.includes('@') || recipientEmail.includes('XXX'))) {
            recipientEmail = (paymentData.metadata && paymentData.metadata.payer_email) || "";
        }
        if (!recipientEmail) return resolve();

        const recipientName = (paymentData.metadata && paymentData.metadata.payer_name) || `${paymentData.payer?.first_name || ""} ${paymentData.payer?.last_name || ""}`.trim() || "Devoto";
        const amount = parseFloat(paymentData.transaction_amount || 0);
        const formattedAmount = amount.toFixed(2).replace('.', ',');
        const orderId = paymentData.metadata?.order_id || (paymentData.id ? `MP-${paymentData.id}` : `SR-${Date.now()}-BR`);

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
                console.log(`Brevo Approved Email (${recipientEmail}) status: ${res.statusCode}`);
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

function getOmegaTransaction(queryParam) {
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
                        resolve(null);
                    }
                } catch (e) {
                    resolve(null);
                }
            });
        });
        req.on('error', () => resolve(null));
        req.end();
    });
}

module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
    );

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { id, orderId } = req.query;
    if (!id && !orderId) {
        return res.status(400).json({ error: 'Missing payment ID or order ID' });
    }

    try {
        let finalOrderId = orderId;
        
        // 1. Try to find the order in Supabase first (by orderId or by transaction ID in tracking_code)
        let dbOrder = null;
        if (finalOrderId) {
            dbOrder = await supabase.getOrderById(finalOrderId);
        } else if (id) {
            dbOrder = await supabase.getOrderByTrackingCode(id);
            if (dbOrder) {
                finalOrderId = dbOrder.id;
            }
        }

        // 2. If already approved in Supabase, return approved immediately
        if (dbOrder && dbOrder.payment_status === 'approved') {
            return res.status(200).json({ status: 'approved' });
        }

        // 3. Query Woovi / OpenPix API first, fallback to Omega Payments
        let rawStatus = 'PENDING';
        let providerTx = null;

        if (finalOrderId) {
            try {
                const wooviTx = await getWooviTransaction(finalOrderId);
                if (wooviTx && wooviTx.status) {
                    rawStatus = wooviTx.status;
                    providerTx = wooviTx;
                }
            } catch (e) {
                console.error("Error querying Woovi status:", e.message);
            }
        }

        // If Woovi returned PENDING or null, query Omega Payments
        if (!['APPROVED', 'PAID', 'SUCCESS', 'CONFIRMED', 'COMPLETED'].includes(rawStatus.toUpperCase())) {
            let omegaTx = null;
            if (finalOrderId) {
                try {
                    omegaTx = await getOmegaTransaction(`clientIdentifier=${encodeURIComponent(finalOrderId)}`);
                } catch (e) {
                    console.error("Error querying by clientIdentifier:", e.message);
                }
            }
            if (omegaTx?.status) {
                rawStatus = omegaTx.status;
                providerTx = omegaTx;
            }
            if (id && !['APPROVED', 'PAID', 'SUCCESS', 'CONFIRMED', 'COMPLETED'].includes(rawStatus.toUpperCase())) {
                try {
                    const omegaTxById = await getOmegaTransaction(`id=${encodeURIComponent(id)}`);
                    if (omegaTxById && ['APPROVED', 'PAID', 'SUCCESS', 'CONFIRMED', 'COMPLETED'].includes((omegaTxById.status || '').toUpperCase())) {
                        rawStatus = omegaTxById.status;
                        providerTx = omegaTxById;
                    }
                } catch (e) {
                    console.error("Error querying by id:", e.message);
                }
            }
        }

        // Map status for frontend compatibility
        let mappedStatus = 'pending';
        
        if (['APPROVED', 'PAID', 'SUCCESS', 'CONFIRMED', 'COMPLETED'].includes(rawStatus.toUpperCase())) {
            mappedStatus = 'approved';
            
            const targetOrderId = finalOrderId || providerTx?.correlationID || providerTx?.identifier || id;
            if (targetOrderId) {
                let orderData = dbOrder;
                let wasPending = (!orderData || orderData.payment_status === 'pending');

                if (wasPending) {
                    console.log(`Order ${targetOrderId} was confirmed paid. Updating DB and firing triggers...`);
                    const updateRes = await supabase.updateOrderIfPending(targetOrderId, { payment_status: 'approved' });
                    
                    // ATOMIC DEDUPLICATION: Only fire Pushcut and conversion triggers if THIS request freshly updated the order from pending to approved!
                    if (Array.isArray(updateRes) && updateRes.length > 0) {
                        orderData = updateRes[0];
                        let rawVal = orderData?.donation_amount || providerTx?.amount || (providerTx?.value ? providerTx.value / 100 : 60.00);
                        let donationAmount = parseFloat(rawVal || 60.00);
                        if (donationAmount > 100) donationAmount = donationAmount / 100;

                        const clientEmail = orderData?.donor_email;
                        const clientName = orderData?.donor_name || "Devoto";
                        const cleanPhone = orderData?.donor_phone || "";

                        const paymentData = {
                            id: targetOrderId,
                            status: 'approved',
                            transaction_amount: donationAmount,
                            metadata: {
                                order_id: targetOrderId,
                                payer_email: clientEmail,
                                payer_name: clientName,
                                payer_phone: cleanPhone
                            },
                            external_reference: targetOrderId,
                            payer: {
                                email: clientEmail,
                                first_name: clientName.split(' ')[0] || "Devoto",
                                last_name: clientName.split(' ').slice(1).join(' ') || ""
                            }
                        };

                        let targetListId = null;
                        if (Math.abs(donationAmount - 50.00) < 0.01 || Math.abs(donationAmount - 60.00) < 0.01) {
                            targetListId = 12;
                        } else if (Math.abs(donationAmount - 10.00) < 0.01 || 
                                   Math.abs(donationAmount - 15.00) < 0.01 || 
                                   Math.abs(donationAmount - 20.00) < 0.01) {
                            targetListId = 5;
                        }

                        console.log(`🎉 FRESH APPROVAL via check-payment for ${targetOrderId}! Triggering Pushcut, Lailla, and Brevo...`);
                        Promise.allSettled([
                            triggerPushcutApprovedByAmount(donationAmount),
                            triggerLaillaApproved(paymentData),
                            removeContactFromBrevoList(clientEmail, 8),
                            targetListId && clientEmail ? addContactToBrevoList(clientEmail, clientName, cleanPhone, targetListId) : Promise.resolve(),
                            clientEmail ? sendBrevoApprovedEmail(paymentData) : Promise.resolve()
                        ]).catch(e => console.error("Error in parallel check-payment triggers:", e));
                    } else {
                        console.log(`Order ${targetOrderId} was ALREADY approved. Skipping duplicate Pushcut & conversion triggers.`);
                    }
                }
            }
        } else if (['REJECTED', 'CANCELED', 'EXPIRED'].includes(rawStatus.toUpperCase())) {
            mappedStatus = 'cancelled';
        }

        return res.status(200).json({ status: mappedStatus });
    } catch (error) {
        console.error("Error querying payment status:", error.message);
        res.status(500).json({ error: 'Payment status query error', details: error.message });
    }
};

function getWooviTransaction(correlationId) {
    return new Promise((resolve) => {
        const appId = process.env.WOOVI_APP_ID || "Q2xpZW50X0lkXzU5MjAxZDg3LTU2ZWQtNGY3NC04NTFjLTgzZTM3NWVhNzhlZTpDbGllbnRfU2VjcmV0XzNiL0NjdDZXa04rWHhPeC9NYkxvNURXNTE2OE1tSndPYVo5MExkc1VjWXc9";

        const req = https.request({
            hostname: 'api.openpix.com.br',
            port: 443,
            path: `/api/v1/charge/${encodeURIComponent(correlationId)}`,
            method: 'GET',
            headers: {
                'Authorization': appId,
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (res.statusCode >= 200 && res.statusCode < 300 && parsed.charge) {
                        resolve(parsed.charge);
                    } else {
                        resolve(null);
                    }
                } catch (e) {
                    resolve(null);
                }
            });
        });
        req.on('error', () => resolve(null));
        req.end();
    });
}
