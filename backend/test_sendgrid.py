# ============================================================
# SENDGRID CONNECTION TEST
# ============================================================
# Purpose:
# Confirm that:
# 1. Python can read our SendGrid API key.
# 2. Our verified sender works.
# 3. SendGrid can deliver email before we integrate it into
#    the actual Telecom Assist support workflow.
# ============================================================

import os

from dotenv import load_dotenv
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail


# Load values stored inside our .env file.
load_dotenv()


# Read SendGrid configuration.
SENDGRID_API_KEY = os.getenv("SENDGRID_API_KEY")
SENDGRID_FROM_EMAIL = os.getenv("SENDGRID_FROM_EMAIL")


# ------------------------------------------------------------
# IMPORTANT:
# For this first test, send the email to yourself.
# Replace this with your own receiving email address.
# ------------------------------------------------------------
TO_EMAIL = "dwivedishubham7007@gmail.com"


# Build the email.
message = Mail(
    from_email=SENDGRID_FROM_EMAIL,
    to_emails=TO_EMAIL,
    subject="Telecom Assist - Email Integration Test",
    html_content="""
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;">
        <h2>Telecom Assist</h2>

        <p>Hello,</p>

        <p>
            SendGrid has been successfully connected to
            Telecom Assist.
        </p>

        <p>
            This confirms that our CPaaS email integration
            is working.
        </p>

        <hr>

        <small>Telecom Assist Support Platform</small>
    </div>
    """
)


try:

    # Create an authenticated SendGrid client.
    sendgrid = SendGridAPIClient(
        SENDGRID_API_KEY
    )

    # Send the email.
    response = sendgrid.send(
        message
    )

    # SendGrid normally returns HTTP 202 when the message
    # has been accepted for delivery.
    print(
        "SendGrid status:",
        response.status_code
    )

    if response.status_code == 202:
        print(
            "SUCCESS: Email accepted by SendGrid."
        )


except Exception as error:

    print(
        "SENDGRID ERROR:",
        error
    )