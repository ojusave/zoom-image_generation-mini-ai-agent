require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const userContextManager = require('./src/services/userContext');
const routes = require('./src/routes');

const app = express();
const port = process.env.PORT || 4000;

// Middleware
app.use(bodyParser.json());

// Initialize user context manager with cleanup
userContextManager.init();

// Routes
app.use('/', routes);

// Start server
app.listen(port, () => console.log(`Zoom Team Chat bot listening on port ${port}!`)); 