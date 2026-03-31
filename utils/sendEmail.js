const nodemailer = require("nodemailer");

/**
 * Sends an email using SMTP.
 * Configured for Gmail/Standard SMTP using credentials from .env.
 */
const sendEmail = async (to, subject, textBody, htmlBody = null) => {
  try {
    const senderName = process.env.APP_NAME || "USDT Platform";
    const senderEmail = process.env.EMAIL_FROM || "noreply@example.com";

    // Gmail/Nodemailer Setup
    // Using SMTP2GO_API_KEY variable as a generic SMTP password since it holds the app password
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com", // Fallback to Gmail since credentials match app password format
      port: 465,
      secure: true, // true for port 465, false for 587
      auth: {
        user: senderEmail,
        pass: process.env.SMTP2GO_API_KEY,
      },
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
    throw new Error("Failed to send email. Check your SMTP credentials in .env.");
  }
};

module.exports = sendEmail;

