require('dotenv').config();

const express = require('express');
const path = require('path');
const drillRoutes = require('./routes/drill');
const statsRoutes = require('./routes/stats');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/drill', drillRoutes);
app.use('/api/stats', statsRoutes);

app.listen(PORT, () => {
  console.log(`Japanese Trainer running at http://localhost:${PORT}`);
});
