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
                            await Promise.allSettled([
                                triggerFacebookCAPI(payer, transaction_amount),
                                triggerPushcutPendingByAmount(transaction_amount),
                                triggerLaillaPending(payer, parsedData, transaction_amount)
                            ]);
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
