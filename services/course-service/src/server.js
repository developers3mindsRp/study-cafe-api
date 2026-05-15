const path = require('path');
try {
  require('dotenv').config({
    path: path.join(__dirname, '../../../.env'),
    override: true,
  });
} catch (_) {
  /* optional */
}

const config = require('./config');
const { createApp } = require('./app');
const { connect } = require('./models');

const app = createApp();

connect()
  .then(() => {
    app.listen(config.port, () =>
      console.log(`${config.serviceName} listening on ${config.port}`)
    );
  })
  .catch((err) => {
    console.error('Failed to start:', err);
    process.exit(1);
  });
