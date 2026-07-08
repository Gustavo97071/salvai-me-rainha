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

        const publicKey = process.env.OMEGA_PUBLIC_KEY || "gustavo8367_waum6srl1idvyytz";
        const secretKey = process.env.OMEGA_SECRET_KEY || "ukcotqp21oyunf3dplchwgu5g7vafh2u3xu9e5l9dr0aw6184df5yi0cttpkg1th";

        const options = {
            hostname: 'app.omegapayments.com.br',
            port: 443,
            path: `/api/v1/gateway/transactions?id=${encodeURIComponent(id)}`,
            method: 'GET',
            headers: {
                'x-public-key': publicKey,
                'x-secret-key': secretKey,
                'User-Agent': 'Mozilla/5.0'
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
                        const rawStatus = parsedData.status || 'PENDING';
                        let mappedStatus = 'pending';
                        
                        if (['APPROVED', 'PAID', 'SUCCESS', 'CONFIRMED'].includes(rawStatus.toUpperCase())) {
                            mappedStatus = 'approved';
                        } else if (['REJECTED', 'CANCELED', 'EXPIRED'].includes(rawStatus.toUpperCase())) {
                            mappedStatus = 'cancelled';
                        }
                        
                        res.status(200).json({ status: mappedStatus });
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
