const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const bcrypt = require('bcrypt');
require('dotenv').config();

const app = express();
app.use(express.json());

// ✅ Test route om te checken of de server draait
app.get('/', (req, res) => {
    res.send("Lease Middleware API is actief!");
});

// ✅ MongoDB Connectie
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
}).then(() => console.log("✅ Verbonden met MongoDB"))
.catch(err => console.log("❌ MongoDB Fout:", err));

// ✅ Gebruikers Schema
const UserSchema = new mongoose.Schema({
    name: String,
    email: String,
    password: String,
    role: { type: String, enum: ['dealer', 'klant'], default: 'klant' },
});
const User = mongoose.model('User', UserSchema);

// ✅ Voertuig Schema
const VehicleSchema = new mongoose.Schema({
    brand: String,
    model: String,
    price: Number,
    available: Boolean,
});
const Vehicle = mongoose.model('Vehicle', VehicleSchema);

// ✅ Lease-offerte Schema
const LeaseSchema = new mongoose.Schema({
    userId: mongoose.Schema.Types.ObjectId,
    vehicleId: mongoose.Schema.Types.ObjectId,
    leaseTerm: Number,
    downPayment: Number,
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
});
const Lease = mongoose.model('Lease', LeaseSchema);

// ✅ Middleware voor authenticatie
const authenticateToken = (req, res, next) => {
    const token = req.header('Authorization');
    if (!token) return res.status(401).json({ message: 'Toegang geweigerd' });

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ message: 'Ongeldig token' });
        req.user = user;
        next();
    });
};

// ✅ Registratie route
app.post('/register', async (req, res) => {
    try {
        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        const user = new User({
            name: req.body.name,
            email: req.body.email,
            password: hashedPassword,
            role: req.body.role,
        });
        await user.save();
        res.json({ message: 'Gebruiker geregistreerd' });
    } catch (err) {
        res.status(500).json({ message: 'Fout bij registreren', error: err.message });
    }
});

// ✅ Login route
app.post('/login', async (req, res) => {
    try {
        const user = await User.findOne({ email: req.body.email });
        if (!user || !(await bcrypt.compare(req.body.password, user.password))) {
            return res.status(400).json({ message: 'Ongeldige inloggegevens' });
        }
        const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
        res.json({ token });
    } catch (err) {
        res.status(500).json({ message: 'Fout bij inloggen', error: err.message });
    }
});

// ✅ Lease-offerte genereren
app.post('/lease', authenticateToken, async (req, res) => {
    try {
        const lease = new Lease({
            userId: req.user.id,
            vehicleId: req.body.vehicleId,
            leaseTerm: req.body.leaseTerm,
            downPayment: req.body.downPayment,
        });
        await lease.save();
        res.json({ message: 'Lease-aanvraag ingediend', lease });
    } catch (err) {
        res.status(500).json({ message: 'Fout bij lease-aanvraag', error: err.message });
    }
});

// ✅ Kredietaanvraag inschieten naar de bank-API
app.post('/credit-check', authenticateToken, async (req, res) => {
    try {
        const lease = await Lease.findById(req.body.leaseId).populate('vehicleId');
        if (!lease) return res.status(404).json({ message: 'Lease niet gevonden' });

        const response = await axios.post(process.env.BANK_API_URL, {
            customer: { id: lease.userId },
            lease_details: {
                car: lease.vehicleId.model,
                price: lease.vehicleId.price,
                duration_months: lease.leaseTerm,
                down_payment: lease.downPayment,
            },
        }, {
            headers: { Authorization: `Bearer ${process.env.BANK_API_KEY}` }
        });

        lease.status = response.data.status;
        await lease.save();
        res.json({ message: 'Kredietcontrole uitgevoerd', status: response.data.status });
    } catch (error) {
        res.status(500).json({ message: 'Fout bij kredietcontrole', error: error.response?.data || error.message });
    }
});

// ✅ Server starten
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server draait op poort ${PORT}`));
