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

    try {
        const { payment_method_id, token, installments, transaction_amount, payer } = req.body;
        
        // Setup payload for Mercado Pago
        const idempotencyKey = req.headers['x-idempotency-key'] || Math.random().toString(36).substring(2, 15);
        const mpAccessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
        
        if (!mpAccessToken) {
            return res.status(500).json({ error: 'Mercado Pago access token not configured' });
        }
        
        const payload = {
            transaction_amount: parseFloat(transaction_amount),
            description: "Campanha Salvai-me Rainha - Camisa Devocional",
            payment_method_id,
            payer: {
                email: payer.email,
                first_name: payer.first_name || "Devoto",
                last_name: payer.last_name || "",
                identification: {
                    type: "CPF",
                    number: payer.identification.number.replace(/\D/g, '')
                }
            }
        };

        if (payment_method_id === 'pix') {
            // Nothing else needed for PIX
        } else {
            // Credit card fields
            payload.token = token;
            payload.installments = parseInt(installments);
            payload.installments = payload.installments || 1;
        }

        const payloadStr = JSON.stringify(payload);

        // Make HTTP Request to Mercado Pago
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
            postRes.on('end', () => {
                try {
                    const parsedData = JSON.parse(data);
                    if (postRes.statusCode >= 200 && postRes.statusCode < 300) {
                        try {
                            triggerFacebookCAPI(payer, transaction_amount);
                        } catch (capiErr) {
                            console.error("Error launching Facebook CAPI:", capiErr.message);
                        }
                        if (payment_method_id === 'pix') {
                            try {
                                triggerLaillaWebhook(payer, parsedData, transaction_amount);
                            } catch (webhookErr) {
                                console.error("Error launching Lailla Webhook:", webhookErr.message);
                            }
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
    const pixelId = "1275998244606117";
    const apiToken = "EAAK6H9X0gZCsBRwTg9ZAjxn98tbQ5FHm6zQ0UpxWgh0kX7Y85FCLsw1KPW8SOjdqBUNGfXZBST09eFGU6GCDdMb68LDl6lzQY7KgwgxnPfvlbmTYkLW58ND6V8fmPmII1yZB3TQe7uMoxHwHI34ZBy1oVeXimAJVvjZAVv5DoZC6fndWZBI48eF07bKZCAtxZCpISwUwZDZD";

    const options = {
        hostname: 'graph.facebook.com',
        port: 443,
        path: `/v17.0/${pixelId}/events?access_token=${apiToken}`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payloadStr)
        }
    };

    const https = require('https');
    const req = https.request(options, (res) => {
        let resData = '';
        res.on('data', (c) => resData += c);
        res.on('end', () => {
            console.log("Facebook CAPI Response:", resData);
        });
    });

    req.on('error', (e) => {
        console.error("Facebook CAPI Error:", e);
    });

    req.write(payloadStr);
    req.end();
}

function triggerLaillaWebhook(payer, parsedData, amount) {
    const laillaUrl = process.env.LAILLA_WEBHOOK_URL || "https://api.lailla.io/v1/webhook/custom/1176ae8a-f7c0-433c-b404-084296d55506";
    if (!laillaUrl) {
        console.log("Lailla webhook URL not configured");
        return;
    }

    let cleanPhone = (payer.phone || "").replace(/\D/g, '');
    if (cleanPhone && !cleanPhone.startsWith('55') && (cleanPhone.length === 10 || cleanPhone.length === 11)) {
        cleanPhone = '55' + cleanPhone;
    }

    const payload = {
        event: "order.pending",
        order: {
            id: parsedData.id ? `MP-${parsedData.id}` : `SR-${Math.floor(Math.random() * 900000 + 100000)}-BR`,
            status: "pending",
            payment_method: parsedData.payment_method_id || "pix",
            amount: parseFloat(amount),
            product: "Camisa Devocional de Nossa Senhora Aparecida",
            pix_code: parsedData.point_of_interaction?.transaction_data?.qr_code || "",
            pix_qr_base64: parsedData.point_of_interaction?.transaction_data?.qr_code_base64 || ""
        },
        customer: {
            name: `${payer.first_name} ${payer.last_name}`.trim(),
            email: payer.email,
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
            console.log("Lailla Webhook Response:", res.statusCode, resData);
        });
    });

    req.on('error', (e) => {
        console.error("Lailla Webhook Error:", e.message);
    });

    req.write(payloadStr);
    req.end();
}
