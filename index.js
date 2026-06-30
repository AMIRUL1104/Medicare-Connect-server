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

// async function run() {
//   try {
// Connect the client to the server	(optional starting in v4.7)
// await client.connect();

client
  .connect((err) => {
    if (err) {
      console.log("Error connecting to MongoDB:", err);
    } else {
      console.log("Connected to MongoDB!");
    }
  })
  .catch(console.dir);

//  database select করা হয়েছে
const database = client.db(process.env.DM_NAME);

const userCollection = database.collection("user");
const patientCollection = database.collection("Patients");
const doctorsCollection = database.collection("Doctors");
const apointmentCollection = database.collection("Appointments");
const reviewsCollection = database.collection("Reviews");
const paymentCollection = database.collection("Payments");
const prescriptionCollection = database.collection("Prescriptions");
const sessionCollection = database.collection("session");
const favouriteCollection = database.collection("FavouriteDoctors");

// ================verify related ==================

const logger = (req, res, next) => {
  console.log("logger logged", req.params);
  next();
};

const verifyToken = async (req, res, next) => {
  // console.log("headers :", req.headers);
  // console.log("userId :", req.params);
  const authHeader = req.headers?.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: "unauthorized access" });
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  const query = { token: token };

  const session = await sessionCollection.findOne(query);
  // console.log("session", session, token);
  const userId = session.userId;

  const userQuery = {
    _id: userId,
  };

  const user = await userCollection.findOne(userQuery);
  // console.log("User of the session ", user);
  req.user = user;
  next();
};

// must be user after verifying middleware
const verifyPatient = (req, res, next) => {
  if (req.user?.role !== "patient") {
    return res.status(403).send({ message: "forbidden access" });
  }

  next();
};

// must be user after verifying middleware
const verifyAdmin = (req, res, next) => {
  if (req.user?.role !== "admin") {
    return res.status(403).send({ message: "forbidden access" });
  }

  next();
};
// must be user after verifying middleware
const verifyDoctor = (req, res, next) => {
  if (req.user?.role !== "doctor") {
    return res.status(403).send({ message: "forbidden access" });
  }

  next();
};

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

app.get("/api/stats/doctor", verifyToken, verifyDoctor, async (req, res) => {
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

    // ২. পেন্ডিং অ্যাপয়েন্টমেন্ট রিকোয়েস্ট সংখ্যা (আপনার স্ট্রাকচার অনুযায়ী appointmentStatus ফিল্ড ইউজ করা হয়েছে)
    const pendingRequests = await apointmentCollection.countDocuments({
      doctorId: id,
      appointmentStatus: "pending",
    });

    // ৩. মোট আর্নিং হিসাব
    const history = await paymentCollection.find({ doctorId: id }).toArray();
    const totalEarning = history.reduce(
      (sum, item) => sum + Number(item.amount || 0),
      0,
    );

    // ৪. ইউনিক পেশেন্ট কাউন্ট এগ্রিগেশন
    const patientResult = await apointmentCollection
      .aggregate([
        { $match: { doctorId: id } },
        { $group: { _id: "$patientId" } }, // ✅ $ sign added
        { $group: { _id: null, totalPatient: { $sum: 1 } } },
        { $project: { _id: 0, totalPatient: 1 } },
      ])
      .toArray();

    const finalPatientCount =
      patientResult.length > 0 ? patientResult[0].totalPatient : 0; // ✅ [0] added

    // ৫. এভারেজ রেটিং এগ্রিগেশন
    const aggResult = await reviewsCollection
      .aggregate([
        { $match: { doctorId: id } },
        { $group: { _id: null, avgRating: { $avg: "$rating" } } },
        {
          $project: { _id: 0, avgRating: { $round: ["$avgRating", 1] } },
        },
      ])
      .toArray();

    const finalAvgRating = aggResult.length > 0 ? aggResult[0].avgRating : 0; // ✅ [0] added

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
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

app.get("/api/stats/admin", verifyToken, verifyAdmin, async (req, res) => {
  try {
    // ১. মোট অ্যাপয়েন্টমেন্ট সংখ্যা (status pending বা reject বাদে)
    const totalAppointments = await apointmentCollection.countDocuments({
      appointmentStatus: { $nin: ["pending", "reject"] },
    });

    // ২. মোট ভেরিফাইড ডাক্তার সংখ্যা
    const totalDoctors = await doctorsCollection.countDocuments({
      verificationStatus: "verified",
    });

    // ৩. মোট রোগী সংখ্যা
    const totalPatients = await patientCollection.countDocuments();

    // ৪. মোট আর্নিং বা পেমেন্ট (MongoDB Aggregation ব্যবহার করে)
    const paymentStats = await paymentCollection
      .aggregate([
        {
          $group: {
            _id: null,
            amount: { $sum: "$amount" }, // আপনার DB ফিল্ডের নাম 'amount' হলে
          },
        },
      ])
      .toArray();

    // যদি পেমেন্ট না থাকে তবে ০ দেখাবে
    const totalEarnings = paymentStats.length > 0 ? paymentStats[0].amount : 0;

    // সাকসেস রেসপন্স
    res.status(200).json({
      success: true,
      stats: {
        totalAppointments,
        totalEarnings,
        totalPatients,
        totalDoctors,
      },
    });
  } catch (error) {
    console.error("Error fetching admin stats:", error);
    res.status(500).json({
      success: false,
      error: "Internal Server Error",
    });
  }
});

// ============== admin related api =============
app.get(
  "/api/admin/doctor-rating-stats",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    try {
      const statistic = await doctorsCollection
        .aggregate([
          {
            // ১. গড়ে রেটিংগুলোকে রাউন্ড (Round) করা হচ্ছে (যেমন: 4.7 বা 4.5 কে 5 অথবা 4 এ রূপান্তর)
            // যদি আপনার ফিল্ডের নাম averageRating না হয়ে অন্য কিছু হয়, তবে সেটি দিন।
            $project: {
              roundedRating: { $round: ["$averageRating", 0] },
            },
          },
          {
            // ২. রাউন্ডেড রেটিং অনুযায়ী গ্রুপ করে মোট ডাক্তারের সংখ্যা গোনা হচ্ছে
            $group: {
              _id: "$roundedRating",
              count: { $sum: 1 },
            },
          },
          {
            // ৩. রেটিং ৫ থেকে ১ ক্রমানুসারে সাজানো (Descending order)
            $sort: { _id: -1 },
          },
        ])
        .toArray();

      // ৪. চার্টের সুবিধার জন্য ডাটা ফরম্যাট করা (যাতে কোনো স্টার খালি থাকলে ০ দেখায়)
      const ratingMap = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };

      statistic.forEach((item) => {
        // কেবল ১ থেকে ৫ এর মধ্যে বৈধ রেটিংগুলো ম্যাপে বসবে
        if (item._id >= 1 && item._id <= 5) {
          ratingMap[item._id] = item.count;
        }
      });

      // Recharts-এর জন্য ফ্রন্টএন্ড ফ্রেন্ডলি অ্যারে ফরম্যাট
      const formattedData = [
        { rating: "5 Star", doctors: ratingMap[5] },
        { rating: "4 Star", doctors: ratingMap[4] },
        { rating: "3 Star", doctors: ratingMap[3] },
        { rating: "2 Star", doctors: ratingMap[2] },
        { rating: "1 Star", doctors: ratingMap[1] },
      ];

      res.status(200).json({ success: true, data: formattedData });
    } catch (error) {
      console.error("Error fetching doctor rating stats:", error);
      res
        .status(500)
        .json({ success: false, message: "Internal Server Error" });
    }
  },
);

// all appointments
app.get("/api/appointments", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const result = await apointmentCollection.find().toArray();
    res.send(result);
  } catch (error) {
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

app.delete("/api/users/:id", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const query = {
      _id: new ObjectId(id),
    };
    const result = await userCollection.deleteOne(query);
    res.send(result);
  } catch (error) {
    res.status(500).json({
      error: "Internal Server Error",
    });
  }
});

app.patch("/api/users/:id", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { role, isSuspended } = req.body;
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const updateDoc = {};
    if (isSuspended) {
      updateDoc.$set = { isSuspended: isSuspended };
    }
    if (role) {
      updateDoc.$set = { role: role };
    }
    const result = await userCollection.updateOne(query, updateDoc);
    res.send(result);
  } catch (error) {
    res.status(500).json({
      error: "Internal Server Error",
    });
  }
});

app.get(
  "/api/reviews/chartdata",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    try {
      // ── MongoDB Aggregation Pipeline ──────────────────────────
      const topDoctorsData = await reviewsCollection
        .aggregate([
          {
            // ১. প্রতি doctorId এর উপর ভিত্তি করে গ্রুপ করা
            $group: {
              _id: "$doctorId",
              doctorName: { $first: "$doctorName" }, // প্রথম ডকুমেন্ট থেকে নাম নেওয়া
              // যদি আপনার ডক্টর স্কিমা বা রিভিউতে ইমেজ থাকে, সেটার জন্য (ভবিষ্যতের সেফটি):
              doctorImage: { $first: "$doctorPhoto" }, // অথবা ডক্টর কালেকশন থেকে লুপ করে আনা যায়, আপাতত প্রথম এন্ট্রি নিচ্ছি
              averageRating: { $avg: "$rating" }, // রেটিং এর গড় (Average) বের করা
              totalReviews: { $sum: 1 }, // ওই ডক্টরের মোট রিভিউ সংখ্যা (অপশনাল)
            },
          },
          {
            // ২. গড় রেটিং অনুযায়ী বড় থেকে ছোট (Descending) সর্ট করা
            $sort: { averageRating: -1 },
          },
          {
            // ৩. শুধুমাত্র টপ ৫ জন ডক্টর নেওয়া
            $limit: 5,
          },
          {
            // ৪. ফ্রন্টএন্ডে পাঠানোর জন্য প্রজেক্ট বা ফরম্যাট করা (গড় রেটিং ২ ডেসিমেল এ ফিক্স করার জন্য সুবিধা)
            $project: {
              _id: 1,
              doctorName: 1,
              doctorImage: 1,
              averageRating: { $round: ["$averageRating", 1] }, // ১ ডেসিমেল পর্যন্ত রাউন্ড (যেমন: 4.8)
              totalReviews: 1,
            },
          },
        ])
        .toArray();

      // res.send({ success: true, data: topDoctorsData }, { status: 200 });
      res.send(topDoctorsData);
    } catch (error) {
      console.error("Analytics API Error:", error);
      return NextResponse.json(
        { success: false, message: "Internal Server Error" },
        { status: 500 },
      );
    }
  },
);

// user
// ================= all  users   API ===============
// ===========================================================
app.get("/api/users", verifyToken, verifyAdmin, async (req, res) => {
  const result = await userCollection.find().toArray();
  res.send(result);
});

app.post("/api/patients", verifyToken, async (req, res) => {
  const newUser = req.body;
  const result = await patientCollection.insertOne(newUser);
  res.send(result);
});

app.get("/api/patients", verifyToken, verifyAdmin, async (req, res) => {
  const result = await patientCollection.find().toArray();
  res.send(result);
});
// get patient by login session id(userId)
app.get("/api/patients/:id", verifyToken, async (req, res) => {
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
app.post("/api/doctors", verifyToken, async (req, res) => {
  const newUser = req.body;
  const result = await doctorsCollection.insertOne(newUser);
  res.send(result);
});

app.get("/api/doctors", async (req, res) => {
  try {
    const allDoctors = req.query.allDoctors;
    const search = req.query.search;
    const verificationStatus = req.query.verificationStatus;
    const sort = req.query.sort; // e.g. "fee-asc", "fee-desc", "experience-asc", "experience-desc", "rating-desc"
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 6;

    // ── Build the MongoDB FILTER object only — never mix skip/limit/sort in here ──
    let query = {};
    if (allDoctors) {
      const allDoctors = await doctorsCollection.find().toArray();
      res.send(allDoctors);
      return;
    }

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

app.get("/api/doctors/:id", verifyToken, async (req, res) => {
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

app.patch("/api/doctors/profile", verifyToken, async (req, res) => {
  try {
    const {
      userId,
      qualifications,
      experience,
      consultationFee,
      specialization,
      hospitalName,
      verificationStatus,
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
    if (verificationStatus)
      updateFields.verificationStatus = verificationStatus;

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
app.get("/api/appointmentslots/:id", verifyToken, async (req, res) => {
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

app.get("/api/appointments/:id", verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    const forPayment = req.query.forPayment;
    const forPatient = req.query.forPatient;
    const forDoctor = req.query.forDoctor;
    const forAppointment = req.query.forAppointment;

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
    if (forAppointment) {
      query._id = new ObjectId(id);
    }

    let result;
    if (forPayment || forAppointment) {
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

app.post("/api/appointments", verifyToken, verifyPatient, async (req, res) => {
  const newAppointment = req.body;
  const result = await apointmentCollection.insertOne(newAppointment);
  res.send(result);
});
app.patch(
  "/api/appointments",
  verifyToken,

  async (req, res) => {
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
  },
);

app.patch("/api/doctors/schedule", verifyToken, async (req, res) => {
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
app.post("/api/payment", verifyToken, verifyPatient, async (req, res) => {
  const payment = req.body;
  const result = await paymentCollection.insertOne(payment);
  res.send(result);
});

// get all payments history
app.get("/api/payment", verifyToken, verifyAdmin, async (req, res) => {
  const result = await paymentCollection.find().toArray();
  res.send(result);
});

app.get("/api/payment/:id", verifyToken, async (req, res) => {
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
app.get("/api/reviews/:id", verifyToken, async (req, res) => {
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
app.get("/api/reviews",async (req,res) => {
  const result = await reviewsCollection.find().toArray();
  res.send(result);
})

// create a review update api for patient
app.patch("/api/reviews", verifyToken, async (req, res) => {
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
app.post("/api/reviews", verifyToken, async (req, res) => {
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
app.delete("/api/reviews/:id", verifyToken, async (req, res) => {
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

// =================== ALL prescription related api  =================
app.post("/api/prescriptions", verifyToken, verifyDoctor, async (req, res) => {
  try {
    const prescription = req.body;
    const result = await prescriptionCollection.insertOne(prescription);
    res.send(result);
  } catch (error) {
    res.status(500).json({
      error: "Internal Server Error",
    });
  }
});
app.patch("/api/prescriptions", verifyToken, verifyDoctor, async (req, res) => {
  try {
    const id = req.body.prescriptionId;
    const { diagnosis, medications, notes } = req.body;
    const query = {
      _id: new ObjectId(id),
    };
    const updateFields = {};
    if (diagnosis) {
      updateFields.diagnosis = diagnosis;
    }
    if (medications) {
      updateFields.medications = medications;
    }
    if (notes) {
      updateFields.notes = notes;
    }
    if (Object.keys(updateFields).length === 0) {
      return res
        .status(400)
        .send({ error: "No configuration fields provided to update" });
    }

    const updateDoc = { $set: updateFields };

    const result = await prescriptionCollection.updateOne(query, updateDoc);

    res.send(result);
  } catch (error) {
    console.error("Doctor schedule update error:", error);
    res.status(500).send({ error: "Internal Server Error" });
  }
});
app.get("/api/prescriptions/:id", verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    const forDoctor = req.query.forDoctor;
    const forPatient = req.query.forPatient;
    const query = {};
    if (forDoctor) {
      query.doctorId = id;
    } else if (forPatient) {
      query.patientId = id;
    } else {
      query._id = new ObjectId(id);
    }

    if (forDoctor || forPatient) {
      const result = await prescriptionCollection.find(query).toArray();
      res.send(result);
      return;
    }
    const result = await prescriptionCollection.findOne(query);
    res.send(result);
  } catch (error) {
    res.status(500).json({
      error: "Internal Server Error",
    });
  }
});

// ==================== favourite related api =====================
app.post("/api/favourite", verifyToken, verifyDoctor, async (req, res) => {
  try {
    const favourite = req.body;
    const result = await favouriteCollection.insertOne(favourite);
    res.send(result);
  } catch (error) {
    res.status(500).json({
      error: "Internal Server Error",
    });
  }
});

app.get("/api/favourite/:id", verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    const forDoctor = req.query.forDoctor;
    const forPatient = req.query.forPatient;
    const query = {};
    if (forDoctor) {
      query._id = new ObjectId(id);
    }
    if (forPatient) {
      query.patientId = id;
    }
    let result;
    if (forPatient) {
      result = await favouriteCollection.find(query).toArray();
    }

    result = await favouriteCollection.findOne(query);
    res.send(result);
  } catch (error) {
    res.status(500).json({
      error: "Internal Server Error",
    });
  }
});

app.delete(
  "/api/favourite/:id",
  verifyToken,
  verifyPatient,
  async (req, res) => {
    try {
      const id = req.params.id;

      const query = {
        _id: new ObjectId(id),
      };

      const result = await favouriteCollection.deleteOne(query);
      res.send(result);
    } catch (error) {
      res.status(500).json({
        error: "Internal Server Error",
      });
    }
  },
);

// ===========================================================
// Send a ping to confirm a successful connection
// ===========================================================

// await client.db("admin").command({ ping: 1 });
// console.log(
//   "Pinged your deployment. You successfully connected to MongoDB!",
// );
//   } finally {
//     // Ensures that the client will close when you finish/error
//     // await client.close();
//   }
// }
// run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World! This Medicare Connect Server ");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});

module.exports = app;
