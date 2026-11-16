# feat: change email from the settings page

Adds `POST /members/me/email` for the signed-in member. The API client sends JSON; the settings
page submits a plain HTML form, so the endpoint reads form-encoded bodies as well as JSON.
