
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const connectDB = require("../config/db");
const mongoose = require("mongoose");
const User = require("../models/User"); // <-- adjust path if needed
const sendEmail = require("../utils/sendEmail"); // <-- your existing function



// -----------------------------
// EMAIL TEMPLATE
// -----------------------------
function buildEligibilityEmail(username) {
  return `
<!DOCTYPE html>
<html lang="en">
  <body style="font-family: Arial, sans-serif; margin: 0; padding: 40px 0">
    <div
      style="
        max-width: 700px;
        margin: auto;
        background: #1b254b;
        color: #ffffff;
        padding: 40px 35px;
        border-radius: 16px;
      "
    >
      <h2 style="font-size: 20px; margin-bottom: 5px">
        <span style="font-size: 32px">XRP Ocean Honors You</span>
      </h2>

      <span
        style="
          font-size: 22px;
          font-weight: 600;
          display: block;
          margin-bottom: 25px;
        "
      >
        Witness the Official Launch of XRP OCEAN
      </span>

      <div
        style="
          text-align: center;
          margin: 20px 0;
          background: #ffffff14;
          padding: 5px 0;
        "
      >
        <img
          src="${process.env.APP_LOGO_URL || "https://example.com/assets/images/logo.png"}"
          alt="Logo"
          style="width: 150px; height: auto"
        />
      </div>

      <!-- CONTENT -->
      <div>
        <div style="font-size: 14px; line-height: 1.7; margin-bottom: 15px">
          Dear ${username || "Achiever"},
        </div>
      

        <div style="font-size: 14px; line-height: 1.7; margin-bottom: 15px">
         We are delighted to cordially invite you to the official launch event of XRP OCEAN.<br /><br />
          It gives us immense pride to confirm that you have successfully
          qualified and are officially invited to join us
          for the
          <strong
            >XRP Ocean Launch Event – Macau & Hongkong, from December 9th
            to 12th, 2025</strong
          >.
        </div>


        <div style="font-size: 14px; line-height: 1.7; margin-bottom: 15px">
          Your achievement is extraordinary and deserves special recognition.<br /><br />
          You delivered
          <strong>exceptional performance during our pre-launch phase</strong> a
          phase where time was limited, the project had not yet been fully
          revealed to the market, and expectations were still being set. Despite
          this, you demonstrated remarkable discipline, belief, and commitment.
        </div>

        <div style="font-size: 14px; line-height: 1.7; margin-bottom: 15px">
          In a period where the industry could only see a glimpse of what XRP
          Ocean will become,
          <strong
            >hundreds of leaders performed beyond imagination and achieved the
            ranks of X1 to X5.</strong
          >
          This is a powerful testament to your leadership and trust.
        </div>

        <div style="font-size: 14px; line-height: 1.7; margin-bottom: 15px">
          Now, as we move towards the official unveiling,
          <strong
            >you will be among the first in the world to witness the real launch
            of the XRP Ocean</strong
          >, including:<br /><br />
          1. Our actual ecosystem and technology vision<br />
          2. Global partnerships and alliances<br />
          3. Strategic roadmap and future direction that we have never revealed
          publicly before
        </div>

        <div style="font-size: 14px; line-height: 1.7; margin-bottom: 15px">
          To ensure a seamless experience, we request a few essential details
          from you. Please click the link below and submit the required
          information:
        </div>

        <!-- BUTTON -->
        <a
          href="https://forms.gle/u16zkrzEokNjjNz87"
          style="
            display: inline-block;
            background: #4d7cff;
            color: #ffffff;
            padding: 12px 22px;
            border-radius: 6px;
            text-decoration: none;
            font-size: 14px;
            font-weight: bold;
            margin: 10px 0 25px 0;
          "
          target="_blank"
          >Submit Your Details</a
        >

        <div style="font-size: 14px; line-height: 1.7; margin-bottom: 15px">
          Once again, congratulations on this outstanding accomplishment.<br />
          We look forward to witness history together.
        </div>

        <div style="font-size: 14px; line-height: 1.7; margin-bottom: 15px">
          <strong>Warm regards,</strong><br />
          <strong>Team XRP Ocean</strong>
        </div>
      </div>

      <!-- TERMS SECTION -->
      <div
        style="
          margin-top: 25px;
          padding: 15px;
          background: #293567;
          border-radius: 6px;
        "
      >
        <p
          style="
            margin: 0 0 10px 0;
            color: #fff;
            font-size: 18px;
            font-weight: 600;
          "
        >
          *T&C:
        </p>
        <div style="font-size: 10px; line-height: 1.5; color: #fff">
          <span style="font-weight: 600"
            >Eligibility for event participation is valid for all users who hold
            the rank of</span
          >
          <strong>X1 to X5</strong> as of
          <strong
            ><span style="font-weight: 600">December 8th, 2025</span></strong
          >.
        </div>
      </div>

      <!-- FOOTER -->
      <div
        style="
          font-size: 12px;
          color: #b9c1d9;
          margin-top: 35px;
          border-top: 1px solid #2f3a65;
          padding-top: 20px;
          text-align: center;
        "
      >
        © 2025 Company. All rights reserved.<br />

      </div>
    </div>
  </body>
</html>
`;
}

// -----------------------------
// MAIN SCRIPT
// -----------------------------
async function sendEligibilityEmails() {
  await connectDB();

  const allowedRanks = ["X1", "X2", "X3", "X4", "X5"];

  console.log("🔍 Fetching eligible users...");

  const users = await User.find(
    { xRank: { $in: allowedRanks }, email: { $exists: true } },
    "email username xRank hasReceivedEligibilityEmail"
  ).lean();

  console.log(`🎯 Found ${users.length} eligible users.`);

  for (const user of users) {
    // OPTIONAL: Skip users already emailed
    // if (user.hasReceivedEligibilityEmail) {
    //   console.log(`⏭️ Already sent: ${user.email}`);
    //   continue;
    // }

    console.log(`📧 Sending to: ${user.email} (${user.xRank})...`);

    try {
      const htmlBody = buildEligibilityEmail(user.username);
      const textBody = `Congratulations ${
        user.username || ""
      }! You are eligible for the XRP Ocean Launch Event.`;


      await sendEmail(
        user.email,
        "You're Invited - XRP Ocean Launch Event",
        textBody,
        htmlBody
      );

      // Mark as sent (optional — requires field in User schema)
      // await User.updateOne(
      //   { _id: user._id },
      //   { hasReceivedEligibilityEmail: true }
      // );

      console.log(`✅ Sent successfully: ${user.email}`);
    } catch (err) {
      console.error(`❌ Failed to send to ${user.email}:`, err);
    }
  }

  console.log("🎉 Done sending eligibility emails!");
  process.exit(0);
}

sendEligibilityEmails();
