const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e8 });
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    store: new pgSession({ pool: pool, tableName: 'session' }),
    secret: 'super-secret-neon-key',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

// AUTH
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query(`SELECT * FROM users WHERE username = $1`, [username]);
        const user = result.rows[0];
        if (user && bcrypt.compareSync(password, user.password)) {
            req.session.userId = user.id;
            req.session.role = user.role;
            await pool.query(`UPDATE users SET is_online = true WHERE id = $1`, [user.id]);
            res.json({ success: true, role: user.role });
        } else res.status(401).json({ success: false, message: 'Invalid credentials' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/register', async (req, res) => {
    const { username, password, full_name, role } = req.body;
    try {
        const hash = bcrypt.hashSync(password, 10);
        await pool.query(`INSERT INTO users (username, password, role, full_name) VALUES ($1, $2, $3, $4)`, [username, hash, role || 'Siswa', full_name]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: 'Username sudah dipakai' }); }
});

app.get('/api/me', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    res.json({ id: req.session.userId, role: req.session.role });
});

// AI ASSISTANT (Simulasi Backend - Ganti dengan OpenAI/Gemini API asli)
app.post('/api/ai', async (req, res) => {
    const { prompt } = req.body;
    // Logika AI di sini (misal pakai fetch ke OpenAI)
    const aiResponse = `[AI Tutor]: Analisis dari pertanyaan "${prompt}"... Materi ini berkaitan dengan pelajaran di kelas. Silakan pelajari lebih lanjut!`;
    await pool.query(`INSERT INTO ai_chats (user_id, prompt, response) VALUES ($1, $2, $3)`, [req.session.userId, prompt, aiResponse]);
    res.json({ reply: aiResponse });
});

// SOCKET.IO (REALTIME CHAT & WEBRTC)
io.on('connection', (socket) => {
    socket.on('join', (userId) => { socket.join(`user_${userId}`); socket.userId = userId; });
    
    socket.on('send_message', async (data) => {
        const { sender_id, receiver_id, message, media, media_type } = data;
        try {
            const result = await pool.query(`INSERT INTO chats (sender_id, receiver_id, message, media, media_type) VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`, [sender_id, receiver_id, message, media, media_type]);
            const msgData = { ...data, id: result.rows[0].id, created_at: result.rows[0].created_at, is_read: false };
            io.to(`user_${receiver_id}`).emit('receive_message', msgData);
            socket.emit('receive_message', msgData);
        } catch(e) { console.log(e); }
    });

    // WebRTC Signaling
    socket.on('callUser', (data) => { io.to(`user_${data.userToCall}`).emit('callUser', data); });
    socket.on('answerCall', (data) => { io.to(`user_${data.to}`).emit('callAccepted', data.signal); });
});

// ROUTING HTML
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/chat', (req, res) => res.sendFile(path.join(__dirname, 'public', 'chat.html')));

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Ultimate Server on ${PORT}`));