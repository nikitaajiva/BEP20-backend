const nodemailer = require("nodemailer");

/**
 * Sends an email using SMTP.
 * Configured for Gmail/Standard SMTP using credentials from .env.
 */
const sendEmail = async (to, subject, textBody, htmlBody = null) => {
  try {
    const senderName = process.env.APP_NAME || "USDT Platform";
    const senderEmail = process.env.EMAIL_FROM || "noreply@example.com";

    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com", // Fallback to Gmail since credentials match app password format
      port: 465,
      secure: true, // true for port 465, false for 587
      auth: {
        user: senderEmail,
        pass: process.env.SMTP2GO_API_KEY,
      },
      connectionTimeout: 5000, // 5 seconds connection timeout
      socketTimeout: 5000,     // 5 seconds socket timeout
    });

    const mailOptions = {
      from: `"${senderName}" <${senderEmail}>`,
      to,
      subject,
      text: textBody,
      ...(htmlBody && { html: htmlBody }),
    };

    const info = await transporter.sendMail(mailOptions);
    return info;
  } catch (error) {
    console.error("❌ Error sending email via SMTP:", error.message);
    
    // In development mode, don't crash if email fails
    if (process.env.NODE_ENV === "development") {
      console.log("--------------------------------------------------");
      console.log("📧 [DEV MODE] EMAIL SUPPRESSED");
      console.log(`To: ${to}`);
      console.log(`Subject: ${subject}`);
      console.log("Check console for content if needed.");
      console.log("--------------------------------------------------");
      return { success: true, message: "Email suppressed in development" };
    }

    throw new Error("Failed to send email. Check your SMTP credentials in .env.");
  }
};

module.exports = sendEmail;

