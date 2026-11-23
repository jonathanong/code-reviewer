# feat: email a farewell when an account is closed

Closing an account now sends a farewell email. A failed send must not stop the account from being
closed, so the send is wrapped in a try/catch that logs and moves on.
