const supabase = require('./supabase');
const https = require('https');

module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const body = req.body || {};
        console.log("Woovi Webhook Received:", JSON.stringify(body));

        const eventType = (body.event || body.type || '').toUpperCase();
        
        let charge = body.charge || {};
        if (!charge.correlationID && !charge.identifier && body.pix?.charge) {
            charge = body.pix.charge;
        }
        if (!charge.correlationID && !charge.identifier && body.transaction?.charge) {
            charge = body.transaction.charge;
        }
        if (!charge.correlationID && !charge.identifier && body.pix) {
            charge = body.pix;
        }

        const correlationID = charge.correlationID || body.correlationID || charge.identifier || body.identifier || body.pix?.correlationID || body.pix?.identifier || body.transaction?.correlationID;
        const status = (charge.status || body.status || body.pix?.status || '').toUpperCase();

        const isCompleted = eventType.includes('COMPLETED') || 
                            eventType.includes('RECEIVED') || 
                            eventType.includes('CONFIRMED') ||
                            ['COMPLETED', 'PAID', 'APPROVED', 'SUCCESS', 'CONFIRMED'].includes(status);

        if (isCompleted && correlationID) {
            console.log(`Woovi Webhook: Order ${correlationID} confirmed paid! Updating DB...`);
            
            const updateRes = await supabase.updateOrderIfPending(correlationID, { payment_status: 'approved' });

            // ATOMIC DEDUPLICATION: Only fire Pushcut and conversion triggers if THIS request freshly updated the order from pending to approved!
            if (Array.isArray(updateRes) && updateRes.length > 0) {
                const orderData = updateRes[0];
                let rawVal = orderData?.donation_amount || (charge.value ? charge.value / 100 : 60.00);
                let donationAmount = parseFloat(rawVal || 60.00);
                if (donationAmount > 100) donationAmount = donationAmount / 100;

                const clientEmail = orderData?.donor_email;
                const clientName = orderData?.donor_name || "Devoto";
                const cleanPhone = orderData?.donor_phone || "";

                const paymentData = {
                    id: correlationID,
                    status: 'approved',
                    transaction_amount: donationAmount,
                    metadata: {
                        order_id: correlationID,
                        payer_email: clientEmail,
                        payer_name: clientName,
                        payer_phone: cleanPhone
                    },
                    external_reference: correlationID,
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

                console.log(`🎉 FRESH APPROVAL for ${correlationID}! Triggering Pushcut, Lailla, and Brevo...`);
                await Promise.allSettled([
                    triggerPushcutApprovedByAmount(donationAmount),
                    triggerLaillaApproved(paymentData),
                    removeContactFromBrevoList(clientEmail, 8),
                    targetListId && clientEmail ? addContactToBrevoList(clientEmail, clientName, cleanPhone, targetListId) : Promise.resolve(),
                    clientEmail ? sendBrevoApprovedEmail(paymentData) : Promise.resolve()
                ]);
            } else {
                console.log(`Order ${correlationID} was ALREADY approved. Skipping duplicate Pushcut & conversion triggers.`);
            }
        }

        return res.status(200).json({ status: 'ok' });
    } catch (err) {
        console.error("Woovi Webhook Error:", err.message);
        return res.status(500).json({ error: err.message });
    }
};

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
            res.on('data', (c) => resData += c);
            res.on('end', () => resolve());
        });

        req.on('error', () => resolve());
        req.end();
    });
}

function triggerLaillaApproved(paymentData) {
    return new Promise((resolve) => {
        const laillaUrl = "https://webhook.lailla.io/v1/webhooks/custom/6a71cb46-9d32-4d2c-8068-07e6ce1fa2b1";
        const payer = paymentData.payer || {};
        const amount = paymentData.transaction_amount;

        const payload = {
            event: "order.approved",
            phone: paymentData.metadata?.payer_phone || "",
            name: paymentData.metadata?.payer_name || "Devoto",
            email: paymentData.metadata?.payer_email || payer.email || "",
            order: {
                id: paymentData.metadata?.order_id || paymentData.id,
                status: "approved",
                payment_method: "pix",
                amount: parseFloat(amount || 0),
                product: "Camisa Devocional de Nossa Senhora Aparecida"
            }
        };

        const payloadStr = JSON.stringify(payload);
        const url = require('url');
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
            res.on('end', () => resolve());
        });

        req.on('error', () => resolve());
        req.write(payloadStr);
        req.end();
    });
}

function removeContactFromBrevoList(email, listId) {
    return new Promise((resolve) => {
        const apiKey = process.env.BREVO_API_KEY;
        if (!apiKey || !email) return resolve();

        const payloadStr = JSON.stringify({ emails: [email] });

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

        const req = https.request(options, () => resolve());
        req.on('error', () => resolve());
        req.write(payloadStr);
        req.end();
    });
}

function addContactToBrevoList(email, name, phone, listId) {
    return new Promise((resolve) => {
        const apiKey = process.env.BREVO_API_KEY;
        if (!apiKey || !email) return resolve();

        const nameParts = name.trim().split(' ');
        const firstName = nameParts[0] || "Devoto";
        const lastName = nameParts.slice(1).join(' ') || "";

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

        if (cleanPhone) payload.attributes.SMS = cleanPhone;

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

        const req = https.request(options, () => resolve());
        req.on('error', () => resolve());
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
        const orderId = paymentData.metadata?.order_id || (paymentData.id ? `SR-${paymentData.id}` : `SR-${Date.now()}-BR`);

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

        const payloadStr = JSON.stringify({
            sender: { name: "Mãe Santíssima", email: senderEmail },
            to: [{ email: recipientEmail, name: recipientName }],
            subject: "Doação Confirmada! Muito obrigado pelo seu apoio 🙏",
            htmlContent: htmlContent
        });

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

        const req = https.request(options, () => resolve());
        req.on('error', () => resolve());
        req.write(payloadStr);
        req.end();
    });
}
