const airdropPromotionConfig = require('../config/airdropPromotionConfig');

exports.getAirdropPromotionConfig = (req, res) => {
    try {
        // We can add logic here in the future to modify the config before sending
        // For example, sending the server time along with it
        const configWithServerTime = {
            ...airdropPromotionConfig,
            serverTime: new Date().getTime(),
        };
        res.status(200).json(configWithServerTime);
    } catch (error) {
        console.error('Error fetching airdrop promotion config:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
}; 
