const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();

const app = express();

// Load environment variables from .env
const port = process.env.PORT;
const uri = process.env.MONGODB_URI;

// app.use(cors());
app.use(
  cors({
    origin: ["http://localhost:3000", process.env.CLIENT_URL],
    credentials: true,
  }),
);
app.use(express.json());

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    //  database select করা হয়েছে
    const database = client.db(process.env.DM_NAME);

    const userCollection = database.collection("user");
    const patientCollection = database.collection("Patients");
    const doctorsCollection = database.collection("Doctors");

    // ================= all  users   API ===============
    // ===========================================================
    app.get("/api/users", async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    app.post("/api/patients", async (req, res) => {
      const newUser = req.body;
      const result = await patientCollection.insertOne(newUser);
      res.send(result);
    });

    app.get("/api/patients", async (req, res) => {
      const result = await patientCollection.find().toArray();
      res.send(result);
    });

    app.post("/api/doctors", async (req, res) => {
      const newUser = req.body;
      const result = await doctorsCollection.insertOne(newUser);
      res.send(result);
    });

    app.get("/api/doctors", async (req, res) => {
      const limit = parseInt(req.query.limit);

      let query = doctorsCollection.find();

      if (limit) {
        query = query.limit(limit);
      }

      const result = await query.toArray();
      res.send(result);
    });

    // ===========================================================
    // Send a ping to confirm a successful connection
    // ===========================================================

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World! This Medicare Connect Server ");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
