import mongoose from 'mongoose';

const uri = process.env.MONGO_URI || process.env.MONGODB_URI;

export async function getDatabase() {
    if (!uri) {
        console.warn("⚠️ MONGO_URI not set - Using memory only");
        return null;
    }
    if (mongoose.connection.readyState === 1) {
        return mongoose.connection.db;
    }
    try {
        await mongoose.connect(uri, { dbName: 'questdb' });
        console.log("📦 MongoDB Connected - Mongoose - Persistent");
        return mongoose.connection.db;
    } catch (err) {
        console.error("❌ MongoDB Connect Error:", err.message);
        return null;
    }
}

export async function getCollection(name) {
    const db = await getDatabase();
    if (!db) return null;
    return db.collection(name);
}

export function isMongoReady() {
    return mongoose.connection.readyState === 1;
}

export const connectDB = getDatabase;
export default getDatabase;
