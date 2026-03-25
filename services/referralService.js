const User = require('../models/User');
const Level = require('../models/Level');
const mongoose = require('mongoose');
const { addDecimal128, multiplyDecimal128 } = require('../utils/decimal128Utils');

const processReferral = async (user, sponsorUsername) => {
    let sponsor;
    if (sponsorUsername) {
        sponsor = await User.findOne({ username: sponsorUsername });
        if (sponsor) {
            user.sponsorId = sponsor._id;
            // The 'path' and 'height' fields might be part of a legacy hierarchy tracking system.
            // While the new logic will use the 'levels' collection, we'll keep these updates
            // to avoid breaking other parts of the application that might still rely on them.
            user.path = [...sponsor.path, sponsor._id];
            user.height = sponsor.height + 1;
        } else {
            console.warn(`Sponsor with username "${sponsorUsername}" not found. Proceeding without a sponsor.`);
        }
    } else {
        // Handle cases with no sponsor if necessary
        user.path = [];
        user.height = 0;
    }

    await user.save(); // Save the user to get their _id

    if (sponsor) {
        await User.updateOne({ _id: sponsor._id }, { $inc: { directDownlines: 1 }});

        // Create Level documents for all ancestors using uhids and the levels collection for hierarchy.
        // This assumes that 'user' and 'sponsor' objects have a 'uhid' property.
        const levelDocs = [];
        const updateOperations = [];
        
        // Level 1: Direct parent
        levelDocs.push({
            parent: sponsor.uhid,
            child: user.uhid,
            level: 1,
        });
        
        // Add update operation for sponsor's community size
        updateOperations.push({
            updateOne: {
                filter: { uhid: sponsor.uhid },
                update: { $inc: { communitySize: 1 } }
            }
        });

        // Find sponsor's ancestors from the Level collection to build the rest of the upline.
        const sponsorLevels = await Level.find({ child: sponsor.uhid }).lean();

        for (const sponsorLevel of sponsorLevels) {
            levelDocs.push({
                parent: sponsorLevel.parent,
                child: user.uhid,
                level: sponsorLevel.level + 1,
            });
            
            // Add update operation for each ancestor's community size
            updateOperations.push({
                updateOne: {
                    filter: { uhid: sponsorLevel.parent },
                    update: { $inc: { communitySize: 1 } }
                }
            });
        }
        
        if (levelDocs.length > 0) {
            await Level.insertMany(levelDocs);
            
            // Execute all community size updates in a single bulk operation
            if (updateOperations.length > 0) {
                await User.bulkWrite(updateOperations);
            }
        }
    }
};

module.exports = {
    processReferral,
}; 