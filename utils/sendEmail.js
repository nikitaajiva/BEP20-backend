const axios = require('axios');
const fs = require('fs');
const path = require('path');
const nodemailer = require("nodemailer");

/**
 * Sends an email using SMTP2Go API.
 * @param {string} to Recipient's email address.
 * @param {string} subject Email subject.
 * @param {string} textBody Plain text version of the email.
 * @param {string} [htmlBody] Optional HTML version of the email.
 * @returns {Promise<object>} SMTP2Go API response data.
 */
// const sendEmail = async (to, subject, textBody, htmlBody = null) => {
//   try {
//     console.log(`📧 Attempting to send email to: ${to}, Subject: ${subject}`);

//     // Create transporter with your Namecheap SMTP details
//     const transporter = nodemailer.createTransport({
//       host:  "server310.web-hosting.com",// "smtp.gmail.com", //"server310.web-hosting.com",     // Outgoing SMTP server
//       port: 465,               // Secure port
//       secure: true,            // true = port 465, false = other ports
//       auth: {
//         user: "noreply@BEPVault.io",   // your Namecheap email
//         pass: "_TaH6+DpPbTp", //"zuzs nbeo thcg jbgq", // your email password
//       },
//     });

//     // Setup email data
//     const mailOptions = {
//       from: `"BEPVault" <noreply@BEPVault.io>`, // sender info
//       to,                                       // recipient(s)
//       bcc: "support@BEPVault.io",
//       subject,                                  // subject line
//       text: textBody,                           // plain text body
//       ...(htmlBody && { html: htmlBody }),      // optional HTML body
//     };

//     // Send mail
//     const info = await transporter.sendMail(mailOptions);
//     console.log("✅ Email sent successfully:", info.messageId);

//     return info;
//   } catch (error) {
//     console.error("❌ Error sending email:", error.message);
//     throw new Error("Failed to send email. Check SMTP settings or logs.");
//   }
// };

const sendEmail = async (to, subject, textBody, htmlBody = null) => {
    try {
        console.log(`Attempting to send email to: ${to}, Subject: ${subject}`);
        
        const emailData = {
            sender: 'BEPVault <noreply@BEPVault.io>', // Fallback sender
            to: [to],
            subject: subject,
            text_body: textBody,
        };

        if (htmlBody) {
            emailData.html_body = htmlBody;
        }

        const response = await axios({
            method: 'post',
            url: 'https://api.smtp2go.com/v3/email/send',
            headers: {
                'Content-Type': 'application/json',
                'X-Smtp2go-Api-Key': process.env.SMTP2GO_API_KEY,
                'accept': 'application/json'
            },
            data: emailData
        });
        
        console.log('Email sent successfully via SMTP2Go. Response:', response.data.request_id);
        return response.data;
    } catch (error) {
        console.error('Error sending email via SMTP2Go:', error.response?.data || error.message);
        // Log the actual error details from SMTP2Go if available
        if (error.response && error.response.data && error.response.data.error_message) {
            console.error('SMTP2Go Error Message:', error.response.data.error_message);
            if (error.response.data.field_errors) {
                console.error('SMTP2Go Field Errors:', error.response.data.field_errors);
            }
        }
        throw new Error('Failed to send email. Please check server logs for details.');
    }
};

module.exports = sendEmail;
