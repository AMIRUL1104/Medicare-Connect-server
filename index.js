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
      try {
        const search = req.query.search;
        const verificationStatus = req.query.verificationStatus;
        const sort = req.query.sort; // e.g. "fee-asc", "fee-desc", "experience-asc", "experience-desc", "rating-desc"
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 6;

        // ── Build the MongoDB FILTER object only — never mix skip/limit/sort in here ──
        let query = {};

        if (search) {
          query.$or = [
            { doctorName: { $regex: search, $options: "i" } },
            { hospitalName: { $regex: search, $options: "i" } },
            { specialization: { $regex: search, $options: "i" } },
          ];
        }

        if (verificationStatus) {
          query.verificationStatus = verificationStatus;
        }

        // ── Build the SORT object separately — map friendly sort keys to real fields ──
        const SORT_MAP = {
          "fee-asc": { consultationFee: 1 },
          "fee-desc": { consultationFee: -1 },
          "experience-asc": { experience: 1 },
          "experience-desc": { experience: -1 },
          "rating-desc": { rating: -1 },
        };
        const sortQuery = SORT_MAP[sort] || {};

        // ── Total count BEFORE pagination, so the client knows totalPages ──
        const total = await doctorsCollection.countDocuments(query);

        // ── Apply filter, sort, skip, limit as separate cursor steps ──
        const doctors = await doctorsCollection
          .find(query)
          .sort(sortQuery)
          .skip(limit * (page - 1))
          .limit(limit)
          .toArray();

        res.send({
          doctors,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit)),
          currentPage: page,
        });
      } catch (error) {
        console.error("GET /api/doctors error:", error);
        res.status(500).send({ message: "Failed to fetch doctors." });
      }
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
