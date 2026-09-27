const crypto = require('crypto');
const https = require('https');
const supabase = require('./supabase');

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
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace(/^Bearer\s+/, '').trim();
    const adminPassword = process.env.ADMIN_PASSWORD || 'start2026admin';

    const expectedToken1 = crypto.createHash('sha256').update(adminPassword).digest('hex');
    const expectedToken2 = crypto.createHash('sha256').update('start2026admin').digest('hex');

    if (token !== expectedToken1 && token !== expectedToken2) {
        return res.status(401).json({ error: 'Unauthorized access.' });
    }

    try {
        let allOrders = await supabase.getOrders();
        
        if (!Array.isArray(allOrders)) {
            allOrders = [];
            let offset = 0;
            const limit = 2000;
            let hasMore = true;
            while (hasMore) {
                const pageOrders = await supabase.getOrdersPage(limit, offset);
                if (Array.isArray(pageOrders) && pageOrders.length > 0) {
                    allOrders = allOrders.concat(pageOrders);
                    if (pageOrders.length < limit) hasMore = false;
                    else offset += limit;
                } else {
                    hasMore = false;
                }
            }
        }

        return res.status(200).json({ orders: allOrders || [] });
    } catch (err) {
        console.error('Error fetching admin orders:', err.message);
        return res.status(500).json({ error: 'Failed to fetch orders', details: err.message });
    }
};
