const https = require('https');

module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { transaction_amount, payer } = req.body || {};

    try {
        const idempotencyKey = req.headers['x-idempotency-key'] || Math.random().toString(36).substring(2, 15);
        const mpAccessToken = "APP_USR-8992204038760430-071022-0017efee923c2d2d7c482f2a4b0d4bde-3535669114";

        let areaCode = "";
        let phoneNumber = "";
        if (payer && payer.phone) {
            const digits = payer.phone.replace(/\D/g, '');
            let localDigits = digits;
            if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
                localDigits = digits.substring(2);
            }
            if (localDigits.length >= 10) {
                areaCode = localDigits.substring(0, 2);
                phoneNumber = localDigits.substring(2);
            } else {
                phoneNumber = localDigits;
            }
        }

        let cleanPhone = "";
        if (payer && payer.phone) {
            cleanPhone = payer.phone.replace(/\D/g, '');
            if (cleanPhone && !cleanPhone.startsWith('55') && (cleanPhone.length === 10 || cleanPhone.length === 11)) {
                cleanPhone = '55' + cleanPhone;
            }
            if (cleanPhone && !cleanPhone.startsWith('+')) {
                cleanPhone = '+' + cleanPhone;
            }
        }

        const payload = {
            transaction_amount: parseFloat(transaction_amount || 50.00),
            description: "Campanha Salvai-me Rainha - Camisa Devocional",
            payment_method_id: "pix",
            notification_url: "https://salvai-me-rainha.vercel.app/api/mercadopago-webhook",
            payer: {
                email: payer.email,
                first_name: payer.first_name || "Devoto",
                last_name: payer.last_name || "",
                identification: {
                    type: "CPF",
                    number: payer.identification?.number?.replace(/\D/g, '') || '24823194047'
                },
                phone: areaCode ? {
                    area_code: areaCode,
                    number: phoneNumber
                } : undefined
            },
            metadata: {
                payer_phone: cleanPhone,
                payer_name: `${payer.first_name || ""} ${payer.last_name || ""}`.trim() || "Devoto",
                payer_email: payer.email
            }
        };

        const payloadStr = JSON.stringify(payload);

        const options = {
            hostname: 'api.mercadopago.com',
            port: 443,
            path: '/v1/payments',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${mpAccessToken}`,
                'Content-Type': 'application/json',
                'X-Idempotency-Key': idempotencyKey,
                'Content-Length': Buffer.byteLength(payloadStr)
            }
        };

        const postReq = https.request(options, (postRes) => {
            let data = '';
            postRes.on('data', (chunk) => {
                data += chunk;
            });
            postRes.on('end', async () => {
                try {
                    const parsedData = JSON.parse(data);
                    if (postRes.statusCode >= 200 && postRes.statusCode < 300) {
                        // Trigger Facebook pixel and Pushcut pending triggers in parallel
                        try {
                            const triggers = [
                                triggerFacebookCAPI(payer, transaction_amount),
                                triggerPushcutPendingByAmount(transaction_amount),
                                triggerLaillaPending(payer, parsedData, transaction_amount)
                            ];
                            if (process.env.ENABLE_BREVO_EMAILS === 'true') {
                                triggers.push(sendBrevoPendingEmail(payer, parsedData, transaction_amount));
                            }
                            await Promise.allSettled(triggers);
                        } catch (triggerErr) {
                            console.error("Error in creation triggers:", triggerErr.message);
                        }

                        res.status(200).json(parsedData);
                    } else {
                        res.status(postRes.statusCode).json(parsedData);
                    }
                } catch (e) {
                    res.status(500).json({ error: 'Failed to parse response from payment gateway', details: data });
                }
            });
        });

        postReq.on('error', (err) => {
            res.status(500).json({ error: 'Payment gateway connection error', details: err.message });
        });

        postReq.write(payloadStr);
        postReq.end();

    } catch (error) {
        console.error("Payment integration error:", error.message);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
};

function triggerFacebookCAPI(payer, amount) {
    const crypto = require('crypto');
    const hash = (str) => {
        if (!str) return undefined;
        return crypto.createHash('sha256').update(str.trim().toLowerCase()).digest('hex');
    };

    let cleanPhone = (payer.phone || "").replace(/\D/g, '');
    if (cleanPhone && !cleanPhone.startsWith('55') && (cleanPhone.length === 10 || cleanPhone.length === 11)) {
        cleanPhone = '55' + cleanPhone;
    }

    const emailHash = hash(payer.email);
    const phoneHash = hash(cleanPhone);
    const firstNameHash = hash(payer.first_name);
    const lastNameHash = hash(payer.last_name);

    const payload = {
        data: [
            {
                event_name: "Purchase",
                event_time: Math.floor(Date.now() / 1000),
                event_source_url: "https://salvai-me-rainha.vercel.app/",
                action_source: "website",
                user_data: {
                    em: emailHash ? [emailHash] : undefined,
                    ph: phoneHash ? [phoneHash] : undefined,
                    fn: firstNameHash ? [firstNameHash] : undefined,
                    ln: lastNameHash ? [lastNameHash] : undefined
                },
                custom_data: {
                    value: parseFloat(amount),
                    currency: "BRL"
                }
            }
        ]
    };

    const payloadStr = JSON.stringify(payload);

    const pixels = [
        {
            id: "1275998244606117",
            token: "EAAK6H9X0gZCsBRwTg9ZAjxn98tbQ5FHm6zQ0UpxWgh0kX7Y85FCLsw1KPW8SOjdqBUNGfXZBST09eFGU6GCDdMb68LDl6lzQY7KgwgxnPfvlbmTYkLW58ND6V8fmPmII1yZB3TQe7uMoxHwHI34ZBy1oVeXimAJVvjZAVv5DoZC6fndWZBI48eF07bKZCAtxZCpISwUwZDZD"
        },
        {
            id: "1344595447110213",
            token: "EAAK93ANGiaIBRZBHyeiZC77JH7ZCPZCf4s5ZCL8ZAtjpOKNSE8AXZCPH1Euwb0NpsxieVBFDZCuP4MmSWkpaUjWJ6vdWfZCzVZBzqjrZC0zZBkjzTYQdqirHN1JZBeDRZBUG0D6HG6Ki5oC8gqOCoLx3r3jEbZBcO4FXdlDVUR174q7b8TFt4k2cwOlf2wxIXZBCRrhoyrJyqQZDZD"
        }
    ];

    const https = require('https');

    const promises = pixels.map(pixel => {
        return new Promise((resolve) => {
            const options = {
                hostname: 'graph.facebook.com',
                port: 443,
                path: `/v17.0/${pixel.id}/events?access_token=${pixel.token}`,
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
                    console.log(`Facebook CAPI Response for ${pixel.id}:`, resData);
                    resolve();
                });
            });

            req.on('error', (e) => {
                console.error(`Facebook CAPI Error for ${pixel.id}:`, e);
                resolve();
            });

            req.write(payloadStr);
            req.end();
        });
    });

    return Promise.all(promises);
}

function triggerPushcutPendingByAmount(amount) {
    return new Promise((resolve) => {
        const roundedAmount = Math.round(amount);
        let pushcutUrl = "";
        
        if (roundedAmount === 10) {
            pushcutUrl = "https://api.pushcut.io/K1TZkL2GM2OjtKHRpac5Y/notifications/Pix%20Gerado%20-%2010";
        } else if (roundedAmount === 15) {
            pushcutUrl = "https://api.pushcut.io/K1TZkL2GM2OjtKHRpac5Y/notifications/Pix%20Gerado%20-%2015";
        } else if (roundedAmount === 20) {
            pushcutUrl = "https://api.pushcut.io/K1TZkL2GM2OjtKHRpac5Y/notifications/Pix%20Gerado%20-%2020";
        } else if (roundedAmount === 50) {
            pushcutUrl = "https://api.pushcut.io/K1TZkL2GM2OjtKHRpac5Y/notifications/Pix%20Gerado%20-%2050";
        } else {
            console.log(`Unknown amount ${roundedAmount} for Pushcut pending. Skipping.`);
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
            res.on('data', (c) => resData += c);
            res.on('end', () => {
                console.log(`Pushcut Pending Webhook (${roundedAmount}) Response status:`, res.statusCode);
                resolve();
            });
        });

        req.on('error', (e) => {
            console.error("Pushcut Pending Webhook Error:", e.message);
            resolve();
        });

        req.end();
    });
}

function triggerLaillaPending(payer, parsedData, amount) {
    return new Promise((resolve) => {
        const laillaUrl = "https://api.lailla.io/v1/webhook/custom/e29eb85a-261b-472a-af04-19fa77e1b770";

        let cleanPhone = "";
        if (payer && payer.phone) {
            cleanPhone = payer.phone.replace(/\D/g, '');
            if (cleanPhone && !cleanPhone.startsWith('55') && (cleanPhone.length === 10 || cleanPhone.length === 11)) {
                cleanPhone = '55' + cleanPhone;
            }
            if (cleanPhone && !cleanPhone.startsWith('+')) {
                cleanPhone = '+' + cleanPhone;
            }
        }

        const payload = {
            event: "order.pending",
            phone: cleanPhone,
            name: `${payer?.first_name || ""} ${payer?.last_name || ""}`.trim() || "Devoto",
            email: payer?.email || "",
            order: {
                id: parsedData.id ? `MP-${parsedData.id}` : `SR-${Date.now()}-BR`,
                status: "pending",
                payment_method: "pix",
                amount: parseFloat(amount || 0),
                product: "Camisa Devocional de Nossa Senhora Aparecida",
                pix_code: parsedData.point_of_interaction?.transaction_data?.qr_code || "",
                pix_qr_base64: parsedData.point_of_interaction?.transaction_data?.qr_code_base64 || ""
            },
            customer: {
                name: `${payer?.first_name || ""} ${payer?.last_name || ""}`.trim() || "Devoto",
                email: payer?.email || "",
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
                console.log("Lailla Pending Webhook Response status:", res.statusCode);
                resolve();
            });
        });

        req.on('error', (e) => {
            console.error("Lailla Pending Webhook Error:", e.message);
            resolve();
        });

        req.write(payloadStr);
        req.end();
    });
}

function sendBrevoPendingEmail(payer, parsedData, amount) {
    return new Promise((resolve) => {
        const apiKey = process.env.BREVO_API_KEY;
        const senderEmail = "contato@maesantissima.com";
        const recipientEmail = payer.email;
        const recipientName = `${payer.first_name || ""} ${payer.last_name || ""}`.trim() || "Devoto";
        const pixCode = parsedData.point_of_interaction?.transaction_data?.qr_code || "";
        const formattedAmount = parseFloat(amount).toFixed(2).replace('.', ',');

        const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Pix Gerado com Sucesso</title>
    <style>
        @media screen and (max-width: 600px) {
            .mobile-stack {
                display: block !important;
                width: 100% !important;
            }
            .mobile-margin {
                margin-top: 15px !important;
            }
        }
    </style>
</head>
<body style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f7f9fa; margin: 0; padding: 0;">
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f7f9fa; padding: 20px 0;">
        <tr>
            <td align="center">
                <table width="600" border="0" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.06); border: 1px solid #e2e8f0;">
                    
                    <!-- Header Banner -->
                    <tr>
                        <td align="center">
                            <img src="https://maesantissima.com/assets/email_banner.png" width="600" style="width: 100%; max-width: 600px; display: block; height: auto;" alt="Mãe Santíssima" />
                        </td>
                    </tr>

                    <!-- Heart Divider -->
                    <tr>
                        <td align="center" style="padding-top: 20px;">
                            <span style="font-size: 16px; color: #d4af37;">💛</span>
                        </td>
                    </tr>

                    <!-- Title -->
                    <tr>
                        <td align="center" style="padding: 10px 30px 15px 30px;">
                            <h2 style="font-size: 26px; color: #061930; font-weight: 800; margin: 0; font-family: Georgia, serif;">Pix gerado com sucesso!</h2>
                            <p style="font-size: 14px; color: #475569; margin: 10px 0 0 0; line-height: 1.5;">Para finalizar sua contribuição, utilize o QR Code ou copie o código Pix abaixo.</p>
                        </td>
                    </tr>

                    <!-- Main Section (Blue Card & QR Code & Instructions) -->
                    <tr>
                        <td style="padding: 10px 30px 25px 30px;">
                            <table width="100%" border="0" cellspacing="0" cellpadding="0">
                                <tr>
                                    <!-- Left Column: Blue Card -->
                                    <td width="170" valign="top" class="mobile-stack" style="background-color: #061930; border-radius: 12px; padding: 20px 15px; text-align: center;">
                                        <div style="font-size: 11px; font-weight: bold; color: #d4af37; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">Valor da Contribuição</div>
                                        <div style="font-size: 18px; font-weight: bold; color: #ffffff; margin-bottom: 2px;">R$</div>
                                        <div style="font-size: 38px; font-weight: 800; color: #ffffff; line-height: 1; margin-bottom: 15px;">${formattedAmount}</div>
                                        <div style="border-top: 1px solid rgba(212, 175, 55, 0.3); padding-top: 15px;">
                                            <span style="font-size: 12px; color: #d4af37; vertical-align: middle;">💛</span>
                                            <div style="font-size: 10px; color: #cbd5e1; margin-top: 8px;">Esse Pix expira em:<br><strong>30:00 minutos</strong></div>
                                        </div>
                                    </td>

                                    <!-- Spacing -->
                                    <td width="15" class="mobile-stack">&nbsp;</td>

                                    <!-- Middle Column: QR Code -->
                                    <td width="180" valign="top" class="mobile-stack mobile-margin" align="center" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 15px;">
                                        <div style="font-size: 12px; font-weight: bold; color: #061930; margin-bottom: 10px;">Escaneie o QR Code</div>
                                        <div style="background-color: #ffffff; padding: 10px; border-radius: 8px; border: 1px solid #cbd5e1; display: inline-block;">
                                            <img src="data:image/jpeg;base64,${parsedData.point_of_interaction?.transaction_data?.qr_code_base64 || ""}" width="130" height="130" style="display: block;" alt="QR Code" />
                                        </div>
                                    </td>

                                    <!-- Spacing -->
                                    <td width="15" class="mobile-stack">&nbsp;</td>

                                    <!-- Right Column: Instructions -->
                                    <td width="160" valign="middle" class="mobile-stack mobile-margin">
                                        <table width="100%" border="0" cellspacing="0" cellpadding="0">
                                            <!-- Step 1 -->
                                            <tr>
                                                <td width="30" valign="top" style="padding-bottom: 12px;">
                                                    <div style="width: 22px; height: 22px; line-height: 22px; background-color: #061930; color: #ffffff; border-radius: 50%; text-align: center; font-size: 11px; font-weight: bold;">1</div>
                                                </td>
                                                <td valign="top" style="font-size: 12px; color: #334155; line-height: 1.4; padding-left: 8px; padding-bottom: 12px;">
                                                    Abra o app do seu banco
                                                </td>
                                            </tr>
                                            <!-- Step 2 -->
                                            <tr>
                                                <td width="30" valign="top" style="padding-bottom: 12px;">
                                                    <div style="width: 22px; height: 22px; line-height: 22px; background-color: #061930; color: #ffffff; border-radius: 50%; text-align: center; font-size: 11px; font-weight: bold;">2</div>
                                                </td>
                                                <td valign="top" style="font-size: 12px; color: #334155; line-height: 1.4; padding-left: 8px; padding-bottom: 12px;">
                                                    Escaneie o QR Code
                                                </td>
                                            </tr>
                                            <!-- Step 3 -->
                                            <tr>
                                                <td width="30" valign="top">
                                                    <div style="width: 22px; height: 22px; line-height: 22px; background-color: #061930; color: #ffffff; border-radius: 50%; text-align: center; font-size: 11px; font-weight: bold;">3</div>
                                                </td>
                                                <td valign="top" style="font-size: 12px; color: #334155; line-height: 1.4; padding-left: 8px;">
                                                    Confirme o pagamento
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Pix Code Box -->
                    <tr>
                        <td style="padding: 0 30px 20px 30px;">
                            <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border: 1px solid #fcd34d; border-radius: 12px; padding: 15px;">
                                <tr>
                                    <td>
                                        <div style="font-size: 11px; font-weight: bold; color: #475569; text-transform: uppercase; margin-bottom: 8px; text-align: center; letter-spacing: 0.5px;">Código Pix (Copia e Cola)</div>
                                        <div style="font-family: monospace; font-size: 11px; color: #334155; word-break: break-all; background-color: #f8fafc; padding: 10px; border-radius: 6px; border: 1px solid #cbd5e1; max-height: 85px; overflow-y: auto; line-height: 1.4;">${pixCode}</div>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Important Message Box -->
                    <tr>
                        <td style="padding: 0 30px 20px 30px;">
                            <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; border-radius: 12px; padding: 15px;">
                                <tr>
                                    <td style="font-size: 13px; color: #334155; line-height: 1.5; text-align: center;">
                                        Sua contribuição é muito importante para que possamos continuar nossa missão.<br><strong>Deus abençoe você e sua família!</strong>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Intercession and Social Networks -->
                    <tr>
                        <td style="padding: 10px 30px 20px 30px; border-top: 1px solid #e2e8f0;">
                            <table width="100%" border="0" cellspacing="0" cellpadding="0">
                                <tr>
                                    <td valign="middle" style="font-size: 13px; color: #475569; line-height: 1.4;">
                                        Que Nossa Senhora Aparecida interceda sempre por você.<br><strong style="color: #d4af37;">Juntos somos mais fortes!</strong>
                                    </td>
                                    <td width="140" align="right" valign="middle">
                                        <div style="font-size: 11px; color: #94a3b8; margin-bottom: 6px;">Acompanhe nosso projeto:</div>
                                        <a href="https://instagram.com" target="_blank" style="text-decoration: none; margin-left: 8px;"><img src="https://cdn-icons-png.flaticon.com/32/733/733558.png" width="22" height="22" style="border:0;" alt="Instagram" /></a>
                                        <a href="https://facebook.com" target="_blank" style="text-decoration: none; margin-left: 8px;"><img src="https://cdn-icons-png.flaticon.com/32/733/733547.png" width="22" height="22" style="border:0;" alt="Facebook" /></a>
                                        <a href="https://youtube.com" target="_blank" style="text-decoration: none; margin-left: 8px;"><img src="https://cdn-icons-png.flaticon.com/32/733/733646.png" width="22" height="22" style="border:0;" alt="YouTube" /></a>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Bottom Bar -->
                    <tr>
                        <td align="center" style="background-color: #061930; padding: 15px 20px; border-top: 3px solid #d4af37;">
                            <span style="font-size: 12px; color: #ffffff; font-weight: bold; letter-spacing: 0.5px;">Nossa Senhora Aparecida, rogai por nós!</span>
                        </td>
                    </tr>

                </table>
            </td>
        </tr>
    </table>
</body>
</html>
        `;

        const payload = {
            sender: { name: "Associação Mãe Santíssima", email: senderEmail },
            to: [{ email: recipientEmail, name: recipientName }],
            subject: "Falta pouco! Copie o seu código PIX para concluir sua doação",
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
                console.log("Brevo Pending Email Response status:", res.statusCode);
                resolve();
            });
        });

        req.on('error', (e) => {
            console.error("Brevo Pending Email Error:", e.message);
            resolve();
        });

        req.write(payloadStr);
        req.end();
    });
}
