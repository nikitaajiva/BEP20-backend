const User = require('../models/User');

/**
 * @desc    Update user's notification settings
 * @route   PUT /api/users/settings/notifications
 * @access  Private
 */
const updateNotificationSettings = async (req, res) => {
    try {
        const { successfulDeposits, withdrawalConfirmations } = req.body;
        const userId = req.user._id;

        // Basic validation
        if (typeof successfulDeposits !== 'boolean' || typeof withdrawalConfirmations !== 'boolean') {
            return res.status(400).json({ message: 'Invalid settings format.' });
        }

        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        user.notificationSettings = {
            successfulDeposits,
            withdrawalConfirmations,
        };

        await user.save();
        
        // Return the updated user object (excluding sensitive fields)
        const userToReturn = {
            _id: user._id,
            username: user.username,
            email: user.email,
            notificationSettings: user.notificationSettings
            // Add other fields from the user object you might want to return
        };


        res.status(200).json({
            message: 'Notification settings updated successfully.',
            user: userToReturn,
        });

    } catch (error) {
        console.error('Error updating notification settings:', error);
        res.status(500).json({ message: 'Server error while updating settings.' });
    }
};

/**
 * @desc    Update user's wallet address
 * @route   PUT /api/users/wallet-address
 * @access  Private
 */
// const updateWalletAddress = async (req, res) => {
//     try {
//         // The field from the frontend will be 'wallet_address'
//         const { wallet_address } = req.body;
//         
//         const userId = req.user._id;

//         if (!wallet_address || typeof wallet_address !== 'string') {
//             return res.status(400).json({ message: 'Invalid wallet address provided.' });
//         }

//         // Check if this wallet address is already used by ANOTHER user
//         const existingUserWithWallet = await User.findOne({ 
//             wallet_address: wallet_address, 
//             _id: { $ne: userId } 
//         });

//         if (existingUserWithWallet) {
//             // Use 409 Conflict status code for duplicate resource
//             return res.status(409).json({ message: 'This wallet address is already registered to another account.' });
//         }

//         const user = await User.findById(userId);

//         if (!user) {
//             return res.status(404).json({ message: 'User not found.' });
//         }

//         // Save the address to the correct field
//         user.wallet_address = wallet_address;
//         await user.save();

//         res.status(200).json({
//             message: 'Wallet address updated successfully.',
//             wallet_address: user.wallet_address,
//         });

//     } catch (error) {
//         console.error('Error updating wallet address:', error);
//         res.status(500).json({ message: 'Server error while updating wallet address.' });
//     }
// };


const updateWalletAddress = async (req, res) => {
  try {
    const { wallet_address } = req.body;
    const userId = req.user._id;

    if (!wallet_address || typeof wallet_address !== "string") {
      return res.status(400).json({ message: "Invalid wallet address provided." });
    }

    const newAddress = wallet_address.trim().toLowerCase();

    // 🔍 Check if another user already uses this address
    const existingUserWithWallet = await User.findOne({
      wallet_address: newAddress,
      _id: { $ne: userId },
    });

    if (existingUserWithWallet) {
      return res.status(409).json({
        message: "This wallet address is already registered to another account.",
      });
    }

    // 🔍 Fetch current user
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    const currentAddress = user.wallet_address ? user.wallet_address.trim().toLowerCase() : "";

    // ✅ If already same, return success
    if (currentAddress === newAddress) {
      return res.status(200).json({
        message: "Wallet address already set to this value.",
        wallet_address: user.wallet_address,
      });
    }

    // 🚫 If already set but different → block
    if (currentAddress && currentAddress !== newAddress) {
      return res.status(403).json({
        message:
          "You cannot change your wallet address. It has already been set to a different value.",
        currentAddress: user.wallet_address,
      });
    }

    // ✅ Safe to set if blank/null
    user.wallet_address = newAddress;
    await user.save();

    res.status(200).json({
      message: "Wallet address updated successfully.",
      wallet_address: user.wallet_address,
    });
  } catch (error) {
    console.error("Error updating wallet address:", error);
    res.status(500).json({ message: "Server error while updating wallet address." });
  }
};

/**
 * @desc    Update user's profile information
 * @route   PUT /api/users/profile
 * @access  Private
 */
const updateUserProfile = async (req, res) => {
    try {
        const userId = req.user._id;
        const { username, country, countryCode, whatsappContact } = req.body;

        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        // Update only the fields that are provided
        if (username) user.username = username;
        if (country) user.country = country;
        if (countryCode) user.countryCode = countryCode;
        if (whatsappContact) user.whatsappContact = whatsappContact;

        const updatedUser = await user.save();

        // It's good practice to not return the full user object
        const userToReturn = {
            _id: updatedUser._id,
            username: updatedUser.username,
            email: updatedUser.email,
            country: updatedUser.country,
            countryCode: updatedUser.countryCode,
            whatsappContact: updatedUser.whatsappContact,
            wallet_address: updatedUser.wallet_address,
            notificationSettings: updatedUser.notificationSettings,
            // Include other fields as needed, but avoid sensitive ones
        };

        res.status(200).json({
            message: 'Profile updated successfully.',
            user: userToReturn
        });

    } catch (error) {
        console.error('Error updating user profile:', error);
        // Handle potential duplicate username error
        if (error.code === 11000 && error.keyPattern && error.keyPattern.username) {
            return res.status(409).json({ message: 'This username is already taken.' });
        }
        res.status(500).json({ message: 'Server error while updating profile.' });
    }
};

module.exports = {
    updateNotificationSettings,
    updateWalletAddress,
    updateUserProfile,
}; 
