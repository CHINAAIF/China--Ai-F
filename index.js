import express from 'express';
const app = express();
const PORT = process.env.PORT || 8080;

app.get('/health', (req, res) => res.json({status:'ok', port:PORT, time:new Date().toISOString()}));
app.get('/ping', (req, res) => res.json({pong:true}));

app.listen(PORT, () => console.log('✅ :' + PORT));
