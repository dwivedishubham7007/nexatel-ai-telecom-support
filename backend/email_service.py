# ============================================================
# EMAIL_SERVICE.PY
# ============================================================
#
# PURPOSE:
# Central place for lifecycle emails.
#
# We intentionally do NOT email on every chat message.
# Emails are only sent for meaningful support events.
# ============================================================

import os

from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail

from dotenv import load_dotenv


# Load .env variables.
load_dotenv()


SENDGRID_API_KEY = os.getenv(
    "SENDGRID_API_KEY"
)

SENDGRID_FROM_EMAIL = os.getenv(
    "SENDGRID_FROM_EMAIL"
)


# ============================================================
# LOW-LEVEL EMAIL FUNCTION
# ============================================================
#
# Returns True if SendGrid accepted the message.
# Returns False if sending failed.
#
# IMPORTANT:
# Email failure should never break the customer support flow.
# ============================================================

def send_email(
    to_email: str,
    subject: str,
    html_content: str,
) -> bool:

    if (
        not SENDGRID_API_KEY
        or not SENDGRID_FROM_EMAIL
        or not to_email
    ):

        print(
            "Email skipped: SendGrid configuration missing."
        )

        return False


    try:

        message = Mail(
            from_email=SENDGRID_FROM_EMAIL,
            to_emails=to_email,
            subject=subject,
            html_content=html_content,
        )


        client = SendGridAPIClient(
            SENDGRID_API_KEY
        )


        response = client.send(
            message
        )


        print(
            f"SendGrid status: {response.status_code}"
        )


        return (
            200
            <= response.status_code
            < 300
        )


    except Exception as error:

        print(
            f"Email delivery failed: {error}"
        )

        return False


# ============================================================
# TICKET ACKNOWLEDGEMENT EMAIL
# ============================================================

def send_ticket_acknowledgement(
    to_email: str,
    customer_name: str,
    ticket_id: str,
    category: str,
):

    subject = (
        f"Support request received — {ticket_id}"
    )


    html = f"""
    <div style="
        font-family:Arial,sans-serif;
        max-width:620px;
        margin:auto;
        color:#222;
    ">

        <h2 style="color:#5f3fe6;">
            Telecom Assist
        </h2>

        <p>
            Hi {customer_name},
        </p>

        <p>
            We’ve received your support request.
        </p>

        <div style="
            background:#f6f4ff;
            padding:16px;
            border-radius:10px;
            margin:18px 0;
        ">

            <strong>Ticket:</strong> {ticket_id}<br>
            <strong>Issue:</strong> {category}<br>
            <strong>Status:</strong> AI Support

        </div>

        <p>
            You can continue the same conversation in Telecom Assist.
            If your issue needs additional review, we’ll keep you updated.
        </p>

        <p>
            Telecom Assist Support
        </p>

    </div>
    """


    return send_email(
        to_email,
        subject,
        html,
    )


# ============================================================
# SUPPORT REVIEW EMAIL
# ============================================================

def send_support_review_email(
    to_email: str,
    customer_name: str,
    ticket_id: str,
    category: str,
):

    subject = (
        f"Support review requested — {ticket_id}"
    )


    html = f"""
    <div style="
        font-family:Arial,sans-serif;
        max-width:620px;
        margin:auto;
        color:#222;
    ">

        <h2 style="color:#5f3fe6;">
            Telecom Assist
        </h2>

        <p>
            Hi {customer_name},
        </p>

        <p>
            Your request has been submitted for additional support review.
        </p>

        <div style="
            background:#fff7e8;
            padding:16px;
            border-radius:10px;
            margin:18px 0;
        ">

            <strong>Ticket:</strong> {ticket_id}<br>
            <strong>Issue:</strong> {category}<br>
            <strong>Status:</strong> Support Review Requested

        </div>

        <p>
            Your existing conversation remains open, so you will not need
            to repeat the issue.
        </p>

        <p>
            Telecom Assist Support
        </p>

    </div>
    """


    return send_email(
        to_email,
        subject,
        html,
    )