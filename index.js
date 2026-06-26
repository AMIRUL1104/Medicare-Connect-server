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
    const apointmentCollection = database.collection("Appointments");
    const reviewsCollection = database.collection("Reviews");
    const paymentCollection = database.collection("Payments");

    // ================= all  stats   API ===============
    // ===========================================================
    app.get("/api/stats", async (req, res) => {
      const totalDoctors = await doctorsCollection.countDocuments();
      const totalPatients = await patientCollection.countDocuments();
      const totalAppointments = await apointmentCollection.countDocuments();
      const totalReviews = await reviewsCollection.countDocuments();
      res.send({
        totalDoctors,
        totalPatients,
        totalAppointments,
        totalReviews,
      });
    });

    app.get("/api/stats/doctor", async (req, res) => {
      try {
        const id = req.query.id;

        if (!id) {
          return res
            .status(400)
            .json({ success: false, error: "Doctor ID is required" });
        }

        // ১. মোট অ্যাপয়েন্টমেন্ট সংখ্যা
        const totalAppointment = await apointmentCollection.countDocuments({
          doctorId: id,
        });

        // ২. পেন্ডিং অ্যাপয়েন্টমেন্ট রিকোয়েস্ট সংখ্যা (স্ট্যাটাস চেক)
        const pendingRequests = await apointmentCollection.countDocuments({
          doctorId: id,
          status: "pending", // আপনার ডাটাবেসের স্ট্যাটাস ফিল্ড অনুযায়ী মিলিয়ে নেবেন
        });

        // ৩. মোট আর্নিং হিসাব (Database level aggregation can be faster, but your reduce logic is fine)
        const history = await paymentCollection
          .find({ doctorId: id })
          .toArray();
        const totalEarning = history.reduce(
          (sum, item) => sum + Number(item.amount || 0),
          0,
        );

        // ৪. ইউনিক পেশেন্ট কাউন্ট এগ্রিগেশন
        const patientResult = await apointmentCollection
          .aggregate([
            { $match: { doctorId: id } },
            { $group: { _id: "patientId" } },
            { $group: { _id: null, totalPatient: { $sum: 1 } } },
            { $project: { _id: 0, totalPatient: 1 } },
          ])
          .toArray();

        // 🛠️ ফিক্স: অ্যারের প্রথম এলিমেন্ট থেকে ডেটা রিড করা হলো
        const finalPatientCount =
          patientResult.length > 0 ? patientResult.totalPatient : 0;

        // ৫. এভারেজ রেটিং এগ্রিগেশন
        const aggResult = await reviewsCollection
          .aggregate([
            { $match: { doctorId: id } },
            { $group: { _id: null, avgRating: { $avg: "$rating" } } },
            { $project: { _id: 0, avgRating: { $round: ["$avgRating", 1] } } },
          ])
          .toArray();

        const finalAvgRating = aggResult.length > 0 ? aggResult.avgRating : 0;

        // ── 🌟 প্রফেশনাল রেসপন্স সেন্ড ──
        res.status(200).json({
          success: true,
          stats: {
            totalAppointments: totalAppointment,
            pendingRequests: pendingRequests,
            totalEarnings: totalEarning,
            patientCount: finalPatientCount,
            averageRating: finalAvgRating,
          },
        });
      } catch (error) {
        console.error("Error fetching doctor stats:", error);
        res
          .status(500)
          .json({ success: false, error: "Internal Server Error" });
      }
    });

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
    // get patient by login session id(userId)
    app.get("/api/patient/:id", async (req, res) => {
      try {
        const id = req.params.id;

        const query = {
          userId: id,
        };

        const result = await patientCollection.findOne(query);

        res.send(result);
      } catch (error) {
        res.status(500).json({
          error: "Internal Server Error",
        });
      }
    });

    // ================= all  doctors   API ===============
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

    app.get("/api/doctors/search", async (req, res) => {
      try {
        const search = req.query.search;
        // const verificationStatus = req.query.verificationStatus;

        // ডাইনামিক কোয়েরি অবজেক্ট তৈরি
        const query = {};

        // ১. নাম দিয়ে সার্চ করার লজিক (Case-insensitive)
        if (search) {
          query.doctorName = { $regex: search, $options: "i" };
        }

        // ২. ভেরিফিকেশন স্ট্যাটাস ফিল্টারিং (যেমন: verified)

        // query.verificationStatus = verificationStatus || "verified";

        // ৩. ডাটাবেজ থেকে ডাটা নিয়ে আসা এবং ফিল্ড প্রজেকশন করা (প্রয়োজনীয় ফিল্ড বাদে বাকিগুলো বাদ দেওয়া)
        const result = await doctorsCollection
          .find(query)
          .project({
            _id: 1,
            doctorName: 1,
            specialization: 1,
            userId: 1,
          })
          .toArray();

        // ফ্রন্টএন্ডে যাতে সহজে অবজেক্ট রিড করা যায় তাই ফরম্যাট করে পাঠানো
        const formattedResult = result.map((doc) => ({
          _id: doc._id,
          name: doc.doctorName,
          specialization: doc.specialization,
          userId: doc.userId,
        }));

        res.send(formattedResult);
      } catch (error) {
        console.error("Doctor search API error:", error);
        res.status(500).json({
          error: "Internal Server Error",
        });
      }
    });

    // get doctor by id

    app.get("/api/doctors/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const from = req.query.from;

        const query = {};
        if (from === "userId") {
          query.userId = id;
        }
        if (from === "id") {
          query._id = new ObjectId(id);
        }

        const result = await doctorsCollection.findOne(query);

        res.send(result);
      } catch (error) {
        res.status(500).json({
          error: "Internal Server Error",
        });
      }
    });

    app.patch("/api/doctors/profile", async (req, res) => {
      try {
        const {
          userId,
          qualifications,
          experience,
          consultationFee,
          specialization,
          hospitalName,
        } = req.body;

        if (!userId) {
          return res.status(400).send({ error: "Missing doctor userId" });
        }
        const query = { userId: userId };

        // ডাইনামিক অবজেক্ট তৈরি
        let updateFields = {};
        if (qualifications) updateFields.qualifications = qualifications;
        if (experience) updateFields.experience = experience;
        if (consultationFee) updateFields.consultationFee = consultationFee;
        if (specialization) updateFields.specialization = specialization;
        if (hospitalName) updateFields.hospitalName = hospitalName;

        if (Object.keys(updateFields).length === 0) {
          return res
            .status(400)
            .send({ error: "No configuration fields provided to update" });
        }

        const updateDoc = { $set: updateFields };
        const result = await doctorsCollection.updateOne(query, updateDoc);

        res.send(result);
      } catch (error) {
        console.error("Database update error:", error);
        res.status(500).send({ error: "Internal Server Error" });
      }
    });

    // ডক্টর কালেকশনের জন্য কোয়েরি (userId ধরে ফিল্টার করা হচ্ছে)

    // ================= all  appointment ralated   API ===============
    // ===========================================================
    app.get("/api/appointmentslots/:id", async (req, res) => {
      try {
        const doctorId = req.params.id;
        const date = req.query.date;

        if (!date) {
          return res.status(400).json({
            success: false,
            message: "Date is required (YYYY-MM-DD)",
          });
        }

        // Step 1: fetch all appointments for this doctor + date
        const appointments = await apointmentCollection
          .find({
            doctorId,
            date,
          })
          .toArray();

        // Step 2: extract booked slots
        const bookedSlots = appointments.map((app) => app.slot);

        // Step 3: response format
        return res.status(200).json({
          success: true,
          doctorId,
          date,
          totalBooked: bookedSlots.length,
          bookedSlots,
          appointments,
        });
      } catch (error) {
        console.error("Slot fetch error:", error);

        return res.status(500).json({
          success: false,
          message: "Internal server error",
        });
      }
    });

    app.get("/api/appointments/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const forPayment = req.query.forPayment;
        const forPatient = req.query.forPatient;
        const forDoctor = req.query.forDoctor;

        const query = {};
        if (forPatient) {
          query.patientId = id;
        }
        if (forPayment) {
          query._id = new ObjectId(id);
        }
        if (forDoctor) {
          query.doctorId = id;
        }

        let result;
        if (forPayment) {
          result = await apointmentCollection.findOne(query);
        } else {
          result = await apointmentCollection.find(query).toArray();
        }

        res.send(result);
      } catch (error) {
        res.status(500).json({
          error: "Internal Server Error",
        });
      }
    });

    app.post("/api/appointments", async (req, res) => {
      const newAppointment = req.body;
      const result = await apointmentCollection.insertOne(newAppointment);
      res.send(result);
    });
    app.patch("/api/appointments", async (req, res) => {
      try {
        const {
          id,
          paymentStatus,
          appointmentStatus,
          workingHours,
          availableDays,
          slotDuration,
        } = req.body;

        const query = {
          _id: new ObjectId(id),
        };

        // $set অপারেটর ব্যবহার করে শুধু status আপডেট করা হচ্ছে
        let updateDoc;
        if (paymentStatus) {
          updateDoc = {
            $set: {
              paymentStatus: paymentStatus,
            },
          };
        }
        if (appointmentStatus) {
          updateDoc = {
            $set: {
              appointmentStatus: appointmentStatus,
            },
          };
        }

        const result = await apointmentCollection.updateOne(query, updateDoc);

        res.send(result);
      } catch (error) {
        console.error("Database update error:", error);
        res.status(500).send({ error: "Internal Server Error" });
      }
    });

    app.patch("/api/doctors/schedule", async (req, res) => {
      try {
        const { userId, availableDays, workingHours, slotDuration } = req.body;

        if (!userId) {
          return res.status(400).send({ error: "Missing doctor userId" });
        }

        // ডক্টর কালেকশনের জন্য কোয়েরি (userId ধরে ফিল্টার করা হচ্ছে)
        const query = { userId: userId };

        // ডাইনামিক অবজেক্ট তৈরি
        let updateFields = {};
        if (availableDays) updateFields.availableDays = availableDays;
        if (workingHours) updateFields.workingHours = workingHours;
        if (slotDuration) updateFields.slotDuration = parseInt(slotDuration);

        if (Object.keys(updateFields).length === 0) {
          return res
            .status(400)
            .send({ error: "No configuration fields provided to update" });
        }

        const updateDoc = { $set: updateFields };

        // মনে রাখবেন: এখানে doctorsCollection হবে, appointments নয়!
        const result = await doctorsCollection.updateOne(query, updateDoc);

        res.send(result);
      } catch (error) {
        console.error("Doctor schedule update error:", error);
        res.status(500).send({ error: "Internal Server Error" });
      }
    });

    // ================= all  users   API ===============
    // ================= all  paymennt related    API ===============
    app.post("/api/payment", async (req, res) => {
      const payment = req.body;
      const result = await paymentCollection.insertOne(payment);
      res.send(result);
    });

    app.get("/api/payment/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const forDoctor = req.query.forDoctor;
        const forPatient = req.query.forPatient;
        const query = {};
        if (forDoctor) {
          query.doctorId = id;
        }
        if (forPatient) {
          query.patientId = id;
        }

        // ১. ডাটাবেজ থেকে ওই ইউজারের সকল পেমেন্ট হিস্ট্রি নিয়ে আসা
        const history = await paymentCollection.find(query).toArray();

        // ২. reduce মেথড দিয়ে সকল পেমেন্টের amount যোগ করা
        const totalPaid = history.reduce((sum, item) => {
          return sum + Number(item.amount || 0);
        }, 0);

        // ৩. অবজেক্ট আকারে রেসপন্স পাঠানো
        res.status(200).json({
          success: true,
          totalPaid: totalPaid, // মোট কত টাকা পে করেছে
          history: history, // পেমেন্টের সম্পূর্ণ লিস্ট
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: "Internal Server Error",
        });
      }
    });

    // ===================all review related api================
    app.get("/api/reviews/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const forDoctor = req.query.forDoctor;
        const forPatient = req.query.forPatient;
        const query = {};
        if (forDoctor) {
          query.doctorId = id;
        }
        if (forPatient) {
          query.patientId = id;
        }

        // ১. ডাটাবেজ থেকে ওই ইউজারের সকল পেমেন্ট হিস্ট্রি নিয়ে আসা
        const reviews = await reviewsCollection.find(query).toArray();

        // ৩. অবজেক্ট আকারে রেসপন্স পাঠানো
        res.status(200).json(reviews);
      } catch (error) {
        res.status(500).json({
          success: false,
          error: "Internal Server Error",
        });
      }
    });

    // create a review update api for patient
    app.patch("/api/reviews", async (req, res) => {
      try {
        const id = req.body.id;

        // 💡 ফ্রন্টএন্ড formData থেকে ফিল্ডগুলো ডিস্ট্রাকচার করে নেওয়া হলো
        const { rating, testimonial } = req.body;

        const query = {
          _id: new ObjectId(id),
        };

        // 💡 শুধুমাত্র আপডেটযোগ্য ফিল্ডগুলো ডাটাবেসে সেট করা হচ্ছে
        // এর ফলে কেউ হ্যাক করে patientId বা doctorId বদলে দিতে পারবে না
        const updateDoc = {
          $set: {
            rating: Number(rating), // নাম্বার টাইপ নিশ্চিত করা হলো
            testimonial: testimonial,
          },
        };

        const result = await reviewsCollection.updateOne(query, updateDoc);

        // যদি এই আইডির কোনো রিভিউ খুঁজে না পাওয়া যায়
        if (result.matchedCount === 0) {
          return res
            .status(404)
            .json({ success: false, error: "Review not found" });
        }

        res.status(200).json({
          success: true,
          message: "Review updated successfully!",
          result,
        });
      } catch (error) {
        console.error("Error updating review:", error);
        res.status(500).json({
          success: false,
          error: "Internal Server Error",
        });
      }
    });
    // create a review post api for patient
    app.post("/api/reviews", async (req, res) => {
      try {
        const review = req.body;
        const result = await reviewsCollection.insertOne(review);
        res.send(result);
      } catch (error) {
        res.status(500).json({
          error: "Internal Server Error",
        });
      }
    });

    // create a review delete api for patient and admin only
    app.delete("/api/reviews/:id", async (req, res) => {
      try {
        const id = req.params.id;

        const query = {
          _id: new ObjectId(id),
        };

        const result = await reviewsCollection.deleteOne(query);
        res.send(result);
      } catch (error) {
        res.status(500).json({
          error: "Internal Server Error",
        });
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
