const https = require('https');

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
        res.status(200).end();
        return;
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { id } = req.query;
        if (!id) {
            return res.status(400).json({ error: 'Missing payment ID' });
        }

        const mpAccessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
        if (!mpAccessToken) {
            return res.status(500).json({ error: 'Mercado Pago access token not configured' });
        }

        const options = {
            hostname: 'api.mercadopago.com',
            port: 443,
            path: `/v1/payments/${id}`,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${mpAccessToken}`
            }
        };

        const getReq = https.request(options, (getRes) => {
            let data = '';
            getRes.on('data', (chunk) => {
                data += chunk;
            });
            getRes.on('end', () => {
                try {
                    const parsedData = JSON.parse(data);
                    if (getRes.statusCode >= 200 && getRes.statusCode < 300) {
                        res.status(200).json({ status: parsedData.status });
                    } else {
                        res.status(getRes.statusCode).json(parsedData);
                    }
                } catch (e) {
                    res.status(500).json({ error: 'Failed to parse response from payment gateway', details: data });
                }
            });
        });

        getReq.on('error', (err) => {
            res.status(500).json({ error: 'Payment gateway connection error', details: err.message });
        });

        getReq.end();

    } catch (error) {
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
};
