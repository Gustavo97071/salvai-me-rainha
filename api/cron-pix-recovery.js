const https = require('https');
const url = require('url');

module.exports = async (req, res) => {
    // Authorize Cron requests (supporting external triggers like cron-job.org)
    const recoveryToken = req.headers['x-recovery-token'];
    const secretToken = "7a8d8e5f2c4b1a0d3f8e6c7d9a0b1c2d";
    if (process.env.NODE_ENV === 'production' && recoveryToken !== secretToken) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        console.log("Starting Pix Recovery Cron Job...");
        const mpToken = "APP_USR-8992204038760430-071022-0017efee923c2d2d7c482f2a4b0d4bde-3535669114";
        const apiKey = process.env.BREVO_API_KEY;

        if (!apiKey) {
            console.error("Missing BREVO_API_KEY");
            return res.status(500).json({ error: "Missing BREVO_API_KEY" });
        }

        // Fetch last 50 payments from Mercado Pago sorted by date_created desc
        const searchPayments = () => {
            return new Promise((resolve) => {
                const options = {
                    hostname: 'api.mercadopago.com',
                    port: 443,
                    path: '/v1/payments/search?sort=date_created&criteria=desc&limit=50',
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${mpToken}`
                    }
                };

                const getReq = https.request(options, (getRes) => {
                    let data = '';
                    getRes.on('data', (chunk) => data += chunk);
                    getRes.on('end', () => {
                        if (getRes.statusCode >= 200 && getRes.statusCode < 300) {
                            try {
                                resolve(JSON.parse(data).results || []);
                            } catch (e) {
                                resolve([]);
                            }
                        } else {
                            console.error("Failed to fetch payments from MP, status:", getRes.statusCode);
                            resolve([]);
                        }
                    });
                });

                getReq.on('error', (e) => {
                    console.error("Error fetching payments from MP:", e.message);
                    resolve([]);
                });

                getReq.end();
            });
        };

        const payments = await searchPayments();
        console.log(`Retrieved ${payments.length} recent payments. Processing pending PIX...`);

        const emailTriggers = [];

        for (const payment of payments) {
            // Process only pending PIX payments
            if (payment.status !== 'pending' || payment.payment_method_id !== 'pix') {
                continue;
            }

            const dateCreatedStr = payment.date_created;
            if (!dateCreatedStr) continue;

            const dateCreated = Date.parse(dateCreatedStr);
            if (isNaN(dateCreated)) continue;

            const diffMinutes = (Date.now() - dateCreated) / 60000;
            const payer = payment.payer || {};
            const metadata = payment.metadata || {};

            let recipientEmail = metadata.payer_email || payer.email;
            if (recipientEmail && (!recipientEmail.includes('@') || recipientEmail.includes('XXX'))) {
                recipientEmail = metadata.payer_email || "";
            }

            const recipientName = metadata.payer_name || `${payer.first_name || ""} ${payer.last_name || ""}`.trim() || "Devoto";
            const amount = parseFloat(payment.transaction_amount || 0);
            const formattedAmount = amount.toFixed(2).replace('.', ',');
            const orderId = payment.id ? `MP-${payment.id}` : `SR-${Date.now()}-BR`;
            const pixCode = payment.point_of_interaction?.transaction_data?.qr_code || "";

            if (!recipientEmail || !pixCode) {
                continue;
            }

            // Window check:
            // Email 1 (Friendly Reminder): 90 - 150 minutes (1.5h - 2.5h)
            // Email 2 (Final Urgency): 1050 - 1110 minutes (17.5h - 18.5h)
            let emailType = 0; // 0 = none, 1 = friendly, 2 = final urgency

            if (diffMinutes >= 90 && diffMinutes < 150) {
                emailType = 1;
            } else if (diffMinutes >= 1050 && diffMinutes < 1110) {
                emailType = 2;
            }

            if (emailType > 0) {
                console.log(`Found eligible pending payment ID: ${payment.id} | EmailType: ${emailType} | DiffMinutes: ${diffMinutes.toFixed(1)}`);
                emailTriggers.push(sendRecoveryEmail(apiKey, emailType, recipientEmail, recipientName, formattedAmount, orderId, pixCode));
            }
        }

        if (emailTriggers.length > 0) {
            await Promise.allSettled(emailTriggers);
            console.log(`Finished executing ${emailTriggers.length} recovery email triggers.`);
        } else {
            console.log("No pending payments met the recovery timeframe criteria in this run.");
        }

        res.status(200).json({ success: true, processed: emailTriggers.length });

    } catch (error) {
        console.error("Cron Job Execution Error:", error.message);
        res.status(500).json({ error: error.message });
    }
};

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
            <p>© 2026 Associação Mãe Santíssima. Todos os direitos reservados.</p>
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
            <p>© 2026 Associação Mãe Santíssima. Todos os direitos reservados.</p>
        </div>
    </div>
</body>
</html>
            `;
        }

        const payload = {
            sender: { name: "Associação Mãe Santíssima", email: senderEmail },
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
    });
}
