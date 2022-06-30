const axios = require('axios');
const SlackWebhook = require('slack-webhook');
require('dotenv').config();

const Slack = new SlackWebhook(process.env.SLACK_WEBHOOK_URL);
const email = process.env.USER_EMAIL;
const secret = process.env.USER_SECRET;
const app = process.env.APP_URL;

async function login(user, pw, url) {
  const request = {
    method: 'POST',
    url: `${url}/api/auth/user/login`,
    data: {
      email: user,
      password: pw,
    },
  };
  let response;
  try {
    response = await axios(request);
  } catch (error) {
    console.log(error);
    response = error.response;
  }

  return response.data;
}

async function areYouAlive(token, url) {
  const request = {
    method: 'GET',
    url: `${url}/api/heartbeat/all`,
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
    },
  };
  let response;
  try {
    response = await axios(request);
  } catch (error) {
    console.log(error);
    response = error.response;
  }
  return response.data;
}

function pretify(message) {
  const string = JSON.stringify(message);
  return string;
}

function statuslinter(key, value){
  if(key === 'status'){
    if(value === 200 ){
      return ':white_check_mark:';
    }
}

(async () => {
const token = await login(email, secret, app);
const isItAlive = await areYouAlive(token, app);
console.log(isItAlive);
const text = pretify(isItAlive);
const env = "Application Testing";
const test = {
	"blocks": [
		{
			"type": "section",
			"text": {
				"type": "mrkdwn",
				"text": `FCA Status for ${env}`
			}
		},
		{
			"type": "divider"
		},
		{
			"type": "section",
			"text": {
				"type": "mrkdwn",
				"text": `*FCA Backend*\n${JSON.stringify(isItAlive.Backend, null, 4)}`
			}
		},
    {
			"type": "section",
			"text": {
				"type": "mrkdwn",
				"text": `*FCA Analysis*\n${JSON.stringify(isItAlive.Analysis, null, 4)}`
			}
		},
    {
			"type": "section",
			"text": {
				"type": "mrkdwn",
				"text": `*FCA Identity*\n${JSON.stringify(isItAlive.Identity, null, 4)}`
			}
		},
    {
			"type": "section",
			"text": {
				"type": "mrkdwn",
				"text": `*FCA Storage*\n${JSON.stringify(isItAlive.Storage.StorageAPI, null, 4)}`
			}
		},
		{
			"type": "section",
			"text": {
				"type": "mrkdwn",
				"text": `*FCA Anonymization*\n${JSON.stringify(isItAlive.Storage.AnonymizationAPI, null, 4)}`
			}
		},
		{
			"type": "section",
			"text": {
				"type": "mrkdwn",
				"text": `*FCA Recommender*\n${JSON.stringify(isItAlive.Recommender, null, 4)}`
			}
		},
		{
			"type": "divider"
		},
		{
			"type": "actions",
			"elements": [
				{
					"type": "button",
					"text": {
						"type": "plain_text",
						"text": "Deploy",
						"emoji": true
					},
					"value": "click_me_123"
				},
				{
					"type": "button",
					"text": {
						"type": "plain_text",
						"text": "Kill",
						"emoji": true
					},
					"value": "click_me_123",
					"url": "https://google.com"
				},
				{
					"type": "button",
					"text": {
						"type": "plain_text",
						"text": "Order Pizza",
						"emoji": true
					},
					"value": "click_me_123",
					"url": "https://google.com"
				}
			]
		}
	]
};

try {
  Slack.send(test);
} catch (error) {
  console.log(error);
}

})();
