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
