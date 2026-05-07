
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
return `<!DOCTYPE html>
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
        We hope you are doing well and progressing with strong momentum.
          <br /><br />
           As XRP Ocean enters one of the most significant phases in its journey, we are pleased to invite you to an Exclusive Zoom Call scheduled for:
          <strong>27th Nov,2025 Thursday </strong>
           <br />
             <strong>11:11 AM IST <br />
                 05:41 AM UTC</strong>
        </div>


        <div style="font-size: 14px; line-height: 1.7; margin-bottom: 15px">
          Zoom link : https://zoom.us/j/91371025469?pwd=gpgoZ4xyupGWOYffaqEwT7KEJ0Hr87.1<br /><br />
          
          <strong>Meeting ID: </strong> 913 7102 5469 <br/>
          <strong>Passcode : </strong> 272036 <br/>
          This session holds special importance, as we will be sharing key insights and updates related to the upcoming XRP Ocean Launch Event in Macau and Hong Kong.
        <br/>
        Your presence on this call will ensure you are fully aligned with the vision, flow, and opportunities ahead.
          </div>

        <div style="font-size: 14px; line-height: 1.7; margin-bottom: 15px">
         During this exclusive Zoom meeting, we will be discussing:
        </div>

        <div style="font-size: 14px; line-height: 1.7; margin-bottom: 15px">
        
         <br /><br />
          1. The agenda and structure of the Launch Event (9th–12th December)<br />
          2. Important announcements<br />
          3. Key leadership alignments before the global rollout<br />
          4. Insightful guidance from the core team to prepare for the launch.<br />

        </div>

        <div style="font-size: 14px; line-height: 1.7; margin-bottom: 15px">
          Your participation is essential as you represent a key pillar of our leadership community. 
          Being informed and aligned at this stage will empower you to maximize the momentum of the launch and lead your teams 
          with clarity.
        </div>

        <div style="font-size: 14px; line-height: 1.7; margin-bottom: 15px">
         Thank you for your continued dedication and excellence. We look forward to hosting you 
         and moving forward together into the most exciting chapter of XRP Ocean.

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

  

  const users = await User.find(
    { xRank: { $in: allowedRanks }, email: { $exists: true } },
    "email username xRank hasReceivedEligibilityEmail"
  ).lean();

  

  for (const user of users) {
    // OPTIONAL: Skip users already emailed
    // if (user.hasReceivedEligibilityEmail) {
    //   
    //   continue;
    // }

    

    try {
      const htmlBody = buildEligibilityEmail(user.username);
      const textBody = `Congratulations ${
        user.username || ""
      }! You are eligible for the XRP Ocean Launch Event.`;


      await sendEmail(
        
        user.email,
        "Exclusive Invitation: Brew with XRP Ocean Warriors",
        textBody,
        htmlBody
      );

      // Mark as sent (optional — requires field in User schema)
      // await User.updateOne(
      //   { _id: user._id },
      //   { hasReceivedEligibilityEmail: true }
      // );

      
    } catch (err) {
      console.error(`❌ Failed to send to ${user.email}:`, err);
    }
  }

  
  process.exit(0);
}

sendEligibilityEmails();
