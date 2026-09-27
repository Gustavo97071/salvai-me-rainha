const https = require('https');
const url = require('url');
const supabase = require('./supabase');

module.exports = async (req, res) => {
    // Authorize Cron requests (supporting native Vercel cron, external query token and header token)
    const parsedUrl = url.parse(req.url, true);
    const recoveryToken = req.headers['x-recovery-token'] || parsedUrl.query?.token;
    const secretToken = "7a8d8e5f2c4b1a0d3f8e6c7d9a0b1c2d";
    const isVercelCron = req.headers['x-vercel-cron'] === '1';

    if (process.env.NODE_ENV === 'production' && !isVercelCron && recoveryToken !== secretToken) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        console.log("Starting Omega Pix Status Sync & Recovery Cron Job...");
        const apiKey = process.env.BREVO_API_KEY;

        // 1. Fetch recent pending orders from Supabase (created in the last 2 hours, top 30)
        const pendingOrders = await supabase.getRecentPendingOrders(2, 30);
        if (!pendingOrders || pendingOrders.length === 0) {
            console.log("No pending orders found in Supabase in the last 24 hours.");
            return res.status(200).json({ success: true, processed: 0, reason: "no_pending_orders" });
        }

        console.log(`Found ${pendingOrders.length} pending orders in Supabase. Syncing status with Omega Payments...`);
        const emailTriggers = [];

        for (const order of pendingOrders) {
            const orderId = order.id;
            const createdTime = Date.parse(order.created_at);
            if (isNaN(createdTime)) continue;

            const diffMinutes = (Date.now() - createdTime) / 60000;

            await new Promise(r => setTimeout(r, 200));

            try {
                // 2. Query Woovi API first, fallback to Omega Payments
                let providerTx = null;
                let rawStatus = 'PENDING';

                try {
                    const wooviTx = await getWooviTransaction(orderId) || (order.tracking_code ? await getWooviTransaction(order.tracking_code) : null);
                    if (wooviTx && wooviTx.status) {
                        rawStatus = wooviTx.status;
                        providerTx = wooviTx;
                    }
                } catch (e) {
                    console.error("Error querying Woovi in cron:", e.message);
                }

                if (!['APPROVED', 'PAID', 'SUCCESS', 'CONFIRMED', 'COMPLETED'].includes(rawStatus.toUpperCase())) {
                    try {
                        let omegaTx = await getOmegaTransactionByIdentifier(orderId);
                        if (!omegaTx && order.tracking_code) {
                            omegaTx = await getOmegaTransactionById(order.tracking_code);
                        }
                        if (omegaTx && omegaTx.status) {
                            rawStatus = omegaTx.status;
                            providerTx = omegaTx;
                        }
                    } catch (e) {
                        console.error("Error querying Omega in cron:", e.message);
                    }
                }

                console.log(`Order ${orderId} status check: ${rawStatus}`);

                if (['APPROVED', 'PAID', 'SUCCESS', 'CONFIRMED', 'COMPLETED'].includes(rawStatus.toUpperCase())) {
                    // Update order as paid
                    console.log(`Order ${orderId} was PAID on gateway. Updating to approved and skipping recovery email.`);
                    
                    const updateRes = await supabase.updateOrderIfPending(orderId, { payment_status: 'approved' });
                    if (Array.isArray(updateRes) && updateRes.length > 0) {
                        // Trigger standard conversion webhooks
                        const donationAmount = parseFloat(order.donation_amount || providerTx?.amount || (providerTx?.value ? providerTx.value / 100 : 60.00));
                        const clientEmail = order.donor_email;
                        const clientName = order.donor_name;
                        const cleanPhone = order.donor_phone;

                        const paymentData = {
                            id: providerTx?.id || orderId,
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
                                first_name: (clientName || "Devoto").split(' ')[0],
                                last_name: (clientName || "").split(' ').slice(1).join(' ')
                            }
                        };

                        await Promise.allSettled([
                            triggerPushcutApprovedByAmount(donationAmount),
                            triggerLaillaApproved(paymentData),
                            removeContactFromBrevoList(clientEmail, 8),
                            (async () => {
                                let targetListId = null;
                                if (Math.abs(donationAmount - 50.00) < 0.01 || Math.abs(donationAmount - 60.00) < 0.01) {
                                    targetListId = 12;
                                } else if (Math.abs(donationAmount - 10.00) < 0.01 || 
                                           Math.abs(donationAmount - 15.00) < 0.01 || 
                                           Math.abs(donationAmount - 20.00) < 0.01) {
                                    targetListId = 5;
                                }
                                if (targetListId && clientEmail) {
                                    await addContactToBrevoList(clientEmail, clientName, cleanPhone, targetListId);
                                }
                            })(),
                            (async () => {
                                if (process.env.ENABLE_BREVO_EMAILS === 'true' && clientEmail) {
                                    await sendBrevoApprovedEmail(paymentData);
                                }
                            })()
                        ]);
                    }
                } else if (['REJECTED', 'CANCELED', 'EXPIRED'].includes(rawStatus.toUpperCase())) {
                    console.log(`Order ${orderId} was cancelled/expired on gateway. Updating to cancelled.`);
                    await supabase.updateOrderIfPending(orderId, { payment_status: 'cancelled' });
                } else {
                    // Recovery emails currently disabled by user preference
                    // Only payment verification and status sync are maintained.
                }
            } catch (txErr) {
                console.error(`Error querying Omega Payments for order ${orderId}:`, txErr.message);
            }
        }

        console.log("Recovery emails are disabled. Synced pending orders successfully.");
        res.status(200).json({ success: true, processed: 0, message: "Recovery emails disabled." });

    } catch (error) {
        console.error("Cron Job Execution Error:", error.message);
        res.status(500).json({ error: error.message });
    }
};

function getOmegaTransactionByIdentifier(identifier) {
    return new Promise((resolve, reject) => {
        const publicKey = process.env.OMEGA_PUBLIC_KEY || "startplataforma_hd2un77uamc15j81";
        const secretKey = process.env.OMEGA_SECRET_KEY || "8paa692vn728sr39p50p8dl3bzlyxcrhn1kg2hx0t3z0x2fhc5tkaq7230vyl2t9";

        const req = https.request({
            hostname: 'app.omegapayments.com.br',
            port: 443,
            path: `/api/v1/gateway/transactions?clientIdentifier=${encodeURIComponent(identifier)}`,
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

function getOmegaTransactionById(id) {
    return new Promise((resolve) => {
        const publicKey = process.env.OMEGA_PUBLIC_KEY || "startplataforma_hd2un77uamc15j81";
        const secretKey = process.env.OMEGA_SECRET_KEY || "8paa692vn728sr39p50p8dl3bzlyxcrhn1kg2hx0t3z0x2fhc5tkaq7230vyl2t9";

        const req = https.request({
            hostname: 'app.omegapayments.com.br',
            port: 443,
            path: `/api/v1/gateway/transactions?id=${encodeURIComponent(id)}`,
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

function sendRecoveryEmail(apiKey, type, recipientEmail, recipientName, formattedAmount, orderId, pixCode) {
    return new Promise((resolve) => {
        const senderEmail = "contato@maesantissima.com";
        const quotedPix = encodeURIComponent(pixCode);
        
        let subject = "";
        let htmlContent = "";

        if (type === 1) {
            subject = "Falta pouco! Conclua sua doação para a campanha Salvai-me Rainha 🙏";
            htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Conclua sua contribuição</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f7f9fa; color: #334155; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
        .content { padding: 30px 24px; }
        .greeting { font-size: 18px; font-weight: 700; color: #061930; margin-top: 0; margin-bottom: 12px; }
        .intro-text { font-size: 14px; line-height: 1.6; color: #475569; margin-bottom: 24px; }
        .pix-box { background-color: #f8fafc; border: 1.5px solid #cbd5e1; border-radius: 8px; padding: 16px; margin-bottom: 24px; text-align: center; }
        .pix-title { font-size: 12px; font-weight: 800; color: #061930; text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.5px; }
        .pix-code { font-family: monospace; font-size: 11px; color: #334155; word-break: break-all; background-color: #ffffff; padding: 10px; border-radius: 6px; border: 1px solid #cbd5e1; margin-bottom: 12px; display: block; max-height: 80px; overflow-y: auto; text-align: left; }
        .pix-instructions { text-align: left; background-color: #fffbeb; border: 1px solid #fef3c7; border-radius: 8px; padding: 14px; margin-bottom: 24px; }
        .pix-instructions h4 { font-size: 13px; font-weight: 800; color: #b45309; margin: 0 0 10px 0; }
        .step { font-size: 12px; line-height: 1.5; color: #78350f; margin-bottom: 8px; }
        .step:last-child { margin-bottom: 0; }
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
            <h2 class="greeting">Olá, ${recipientName}!</h2>
            <p class="intro-text">Percebemos que você iniciou a sua participação na campanha <strong>Salvai-me Rainha</strong>, mas ainda não concluiu a contribuição. Para garantir o envio da sua Camisa Devocional de Nossa Senhora Aparecida, utilize o código PIX Copia e Cola atualizado abaixo:</p>
            
            <div class="pix-box">
                <div class="pix-title">Código PIX Copia e Cola</div>
                <code class="pix-code">${pixCode}</code>
            </div>
 
            <div style="text-align: center; margin-top: -15px; margin-bottom: 24px;">
                <a href="https://maesantissima.com/copy-pix.html?code=${quotedPix}" target="_blank" style="display: inline-block; background-color: #16a34a; color: #ffffff !important; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 700; box-shadow: 0 4px 12px rgba(22, 163, 74, 0.2);">📋 Copiar Código PIX</a>
            </div>
 
            <div class="pix-instructions">
                <h4>💡 Lembramos como pagar:</h4>
                <div class="step"><strong>1.</strong> Clique no botão verde acima para copiar o código.</div>
                <div class="step"><strong>2.</strong> Abra o aplicativo do seu banco e vá na opção <strong>"Pix Copia e Cola"</strong>.</div>
                <div class="step"><strong>3.</strong> Cole o código e confirme o pagamento de <strong>R$ ${formattedAmount}</strong>.</div>
            </div>
 
            <table class="summary-table">
                <tr>
                    <th>Item Solicitado</th>
                    <td>Camisa Devocional de Nossa Senhora Aparecida (Grátis)</td>
                </tr>
                <tr>
                    <th>Doação</th>
                    <td>R$ ${formattedAmount}</td>
                </tr>
            </table>
 
            <p style="font-size: 13px; color: #475569; line-height: 1.5; text-align: center; margin-top: 25px; border-top: 1px solid #e2e8f0; padding-top: 20px; margin-bottom: 0;">
                Sua ajuda nos permite continuar propagando o amor à Nossa Mãe Santíssima. Deus abençoe você! 💛
            </p>
        </div>
        <div class="footer">
            <p>© 2026 Mãe Santíssima. Todos os direitos reservados.</p>
        </div>
    </div>
</body>
</html>
            `;
        } else {
            subject = "⚠️ ATENÇÃO: Seu código PIX expira em poucas horas!";
            htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Seu Pix expira em breve</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f7f9fa; color: #334155; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
        .content { padding: 30px 24px; }
        .greeting { font-size: 18px; font-weight: 700; color: #e11d48; margin-top: 0; margin-bottom: 12px; }
        .intro-text { font-size: 14px; line-height: 1.6; color: #475569; margin-bottom: 24px; }
        .pix-box { background-color: #fff1f2; border: 1.5px solid #fecdd3; border-radius: 8px; padding: 16px; margin-bottom: 24px; text-align: center; }
        .pix-title { font-size: 12px; font-weight: 800; color: #991b1b; text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.5px; }
        .pix-code { font-family: monospace; font-size: 11px; color: #991b1b; word-break: break-all; background-color: #ffffff; padding: 10px; border-radius: 6px; border: 1px solid #fecdd3; margin-bottom: 12px; display: block; max-height: 80px; overflow-y: auto; text-align: left; }
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
            <h2 class="greeting">⚠️ Atenção: Seu código PIX está prestes a expirar!</h2>
            <p class="intro-text">Olá, <strong>${recipientName}</strong>! O código PIX gerado para a sua contribuição na campanha <strong>Salvai-me Rainha</strong> vai expirar em poucas horas. Caso expire, seu pedido de envio da Camisa Devocional será cancelado automaticamente.</p>
            
            <div style="text-align: center; margin-bottom: 24px; background-color: #f8fafc; padding: 16px; border-radius: 8px; border: 1px solid #cbd5e1;">
                <p style="font-size: 13px; font-weight: 700; color: #061930; margin-top: 0; margin-bottom: 12px; text-align: center;">🙏 Veja como a Camisa Devocional fica linda no corpo! (Devota Maria):</p>
                <img src="https://maesantissima.com/assets/social_proof.jpg" width="300" style="width: 100%; max-width: 300px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.1); display: inline-block;" alt="Devota com a Camisa Devocional de Nossa Senhora Aparecida" />
                <p style="font-size: 12px; color: #64748b; line-height: 1.4; margin-top: 10px; margin-bottom: 0; font-style: italic;">"A qualidade é maravilhosa, o tecido é muito macio e a estampa de Nossa Senhora Aparecida é perfeita e cheia de detalhes!"</p>
            </div>
 
            <div class="pix-box">
                <div class="pix-title">Código PIX Copia e Cola (Expira em breve)</div>
                <code class="pix-code">${pixCode}</code>
            </div>
 
            <div style="text-align: center; margin-top: -15px; margin-bottom: 24px;">
                <a href="https://maesantissima.com/copy-pix.html?code=${quotedPix}" target="_blank" style="display: inline-block; background-color: #e11d48; color: #ffffff !important; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 700; box-shadow: 0 4px 12px rgba(225, 29, 72, 0.2);">📋 Copiar Código PIX</a>
            </div>
 
            <table class="summary-table">
                <tr>
                    <th>Item Solicitado</th>
                    <td>Camisa Devocional de Nossa Senhora Aparecida (Grátis)</td>
                </tr>
                <tr>
                    <th>Doação</th>
                    <td>R$ ${formattedAmount}</td>
                </tr>
            </table>
 
            <p style="font-size: 13px; color: #475569; line-height: 1.5; text-align: center; margin-top: 25px; border-top: 1px solid #e2e8f0; padding-top: 20px; margin-bottom: 0;">
                Se precisar de ajuda ou tiver alguma dúvida, entre em contato conosco. Que a Virgem Maria abençoe sua família! 💛
            </p>
        </div>
        <div class="footer">
            <p>© 2026 Mãe Santíssima. Todos os direitos reservados.</p>
        </div>
    </div>
</body>
</html>
            `;
        }

        const payload = {
            sender: { name: "Mãe Santíssima", email: senderEmail },
            to: [{ email: recipientEmail, name: recipientName }],
            subject: subject,
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
                console.log(`Cron Recovery Email type ${type} sent to ${recipientEmail}. Status:`, res.statusCode);
                resolve();
            });
        });

        req.on('error', (e) => {
            console.error(`Cron Recovery Email type ${type} to ${recipientEmail} failed:`, e.message);
            resolve();
        });

        req.write(payloadStr);
        req.end();
function getWooviTransaction(chargeId) {
    return new Promise((resolve) => {
        const app_id = process.env.WOOVI_APP_ID || "Q2xpZW50X0lkXzU5MjAxZDg3LTU2ZWQtNGY3NC04NTFjLTgzZTM3NWVhNzhlZTpDbGllbnRfU2VjcmV0XzNiL0NjdDZXa04rWHhPeC9NYkxvNURXNTE2OE1tSndPYVo5MExkc1VjWXc9";
        const options = {
            hostname: 'api.openpix.com.br',
            port: 443,
            path: `/api/v1/charge/${encodeURIComponent(chargeId)}`,
            method: 'GET',
            headers: {
                'Authorization': app_id,
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
            }
        };

        const req = https.request(options, (res) => {
            let resData = '';
            res.on('data', (c) => resData += c);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const parsed = JSON.parse(resData);
                        return resolve(parsed.charge || null);
                    } catch (e) {
                        return resolve(null);
                    }
                }
                return resolve(null);
            });
        });

        req.on('error', () => resolve(null));
        req.end();
    });
}

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
                id: paymentData.external_reference || `SR-${Math.floor(Math.random() * 900000 + 100000)}-BR`,
                status: "approved",
                payment_method: "pix",
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
        const recipientEmail = paymentData.payer?.email;
        const recipientName = `${paymentData.payer?.first_name || ""} ${paymentData.payer?.last_name || ""}`.trim() || "Devoto";
        const amount = parseFloat(paymentData.transaction_amount || 0);
        const formattedAmount = amount.toFixed(2).replace('.', ',');
        const orderId = paymentData.external_reference || `SR-${Date.now()}-BR`;

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
