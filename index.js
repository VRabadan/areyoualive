const axios = require('axios');
const { version } = require('prettier');
const SlackWebhook = require('slack-webhook');
const environments = require('./config.json');
require('dotenv').config();

const slack = new SlackWebhook(process.env.SLACK_WEBHOOK_URL);

const init = {
  "blocks": [
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": `${process.env.APP_NAME}`
      }
    },
    {
      "type": "divider"
    },
  ]
};

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
    return response.data;
  } catch (error) {
    console.log(error);
    if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET') {
      response = {
        Login: {
          message: error.syscall,
          status: error.errno,
          version: 'N/A'
        }
      };
    } else {
      response = {
        Login: {
          message: error.response.statusText,
          status: error.response.status,
          version: 'N/A'
        }
      };
      return response;
    }
  }
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
    return response.data;
  } catch (error) {
    console.log(error);
    if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET') {
      response = {
        Heartbeat: {
          message: error.syscall,
          status: error.errno,
          version: 'N/A'
        }
      };
    } else {
      response = {
        Heartbeat: {
          message: error.response.statusText,
          status: error.response.status,
          version: 'N/A'
        }
      };
      return response;
    }
  }
}

function formatMessage(key, value) {
  if (value[key].status >= 200 && value[key].status < 400) {
    return `:white_check_mark: ${value[key].message} Version ${value[key].version} \n`;
  } else {
    return `:x: ${key} Error ${value[key].status}: ${value[key].message} Version ${value[key].version} \n`;
  }
}

function statuslinter(value) {
  const keys = Object.keys(value);
  const message = keys.reduce((p, c) => {
    if (Object.keys(value[c]).length > 0) {
      const formatedMessage = value[c].status ? formatMessage(c, value) : statuslinter(value[c]);
      p += formatedMessage;
      return p;
    }
    return p;
  }, '');
  return message;
}

function concatenateEnv(env, data, message) {
  const newenv = {
    "type": "section",
    "text": {
      "type": "mrkdwn",
      "text": `*${env}*\n${statuslinter(data)}`
    }
  };

  message.blocks.push(newenv);
  return message;
}

(async () => {

  const message = init;
  for (const env in environments) {
    const token = await login(environments[env].mail, environments[env].secret, environments[env].url);
    if (!token) {
      console.log(`${env} - Login Error`);
      concatenateEnv(env, token, message);
    } else {
      const data = await areYouAlive(token, environments[env].url);
      if (environments[env].skip) {
        for (const app of environments[env].skip) {
          const keys = app.split('.');
          if(keys.length > 1) {
            delete data[keys[0]][keys[1]];
          } else {
            delete data[app];
          }
        }
      }
      concatenateEnv(env, data, message);
    }
  }
  try {
    meta = slack.send(message);
    console.log(meta);
  } catch (error) {
    console.log(error);
  }
})();
