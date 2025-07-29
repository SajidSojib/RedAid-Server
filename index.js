require("dotenv").config();
const express = require("express");
const cors = require("cors");
const stripe = require("stripe")(process.env.PAYMENT_GATEWAY_KEY);
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const port = process.env.PORT || 9000;
const admin = require("firebase-admin");
const fbKey = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf-8"
);
const serviceAccount = JSON.parse(fbKey);

app.use(cors());
app.use(express.json());


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.rydkrvl.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

async function run() {
  try {
    // await client.connect();
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );

    const userCollection = client.db("redAid").collection("users");
    const donationRequestCollection = client.db("redAid").collection("donationRequests");
    const blogCollection = client.db("redAid").collection("blogs");
    const fundCollection = client.db("redAid").collection("funds");


    /****** middleware *******/

    const varifyFBToken = async (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).send({ message: "Unauthorized Access" });
      }
      
      const token = authHeader.split(" ")[1];
      if (!token) {
        return res.status(401).send({ message: "Unauthorized Access" });
      }

      try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded = decoded;
        next();
      } catch (error) {
        return res.status(403).send({ message: "Forbidden Access" });
      }
    };

    const varifyEmail = async (req, res, next) => {
        if(req.decoded.email == req.body?.email || req.decoded.email == req.query?.email || req.decoded.email == req.params?.email) {
            next();
        } else {
            return res.status(403).send({ message: "Forbidden Access" });
        }
    };

    const varifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      if (!user || user?.role !== "admin") {
        return res.status(403).send({ message: "Forbidden Access" });
      }
      next();
    };
    const varifyVolunteer = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      if (!user || user?.role !== "volunteer") {
        return res.status(403).send({ message: "Forbidden Access" });
      }
      next();
    };
    const varifyAdminVolunteer = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      if (!user || (user?.role !== "admin" && user?.role !== "volunteer")) {
        return res.status(403).send({ message: "Forbidden Access" });
      }
      next();
    };



    app.get('/stats',varifyFBToken, varifyAdminVolunteer, async (req, res) => {
      try {
        const totalUsers = await userCollection.countDocuments();
      const totalRequests = await donationRequestCollection.countDocuments();
      const totalFundResult = await fundCollection.aggregate([
        {
          $group: {
            _id: null,
            totalFundAmount: {
              $sum: { $toDouble: "$amount" } 
            }
          }
        }
      ]).toArray();
      res.send({
        totalUsers,
        totalRequests,
        totalFundAmount: totalFundResult[0]?.totalFundAmount
      });
      } catch (error) {
        console.error("Error fetching stats:", error);
        res.status(500).send({ message: "Internal server error" });
      }
      })
    /****** donor api *******/
   
    app.get("/donors", async (req, res) => {
      try {
        const { bloodGroup, division, district, upazila } = req.query;

        // Build dynamic filter object
        const filter = { role: "donor", status: "active" };
        if (bloodGroup) filter.bloodGroup = bloodGroup;
        if (division) filter.division = division;
        if (district) filter.district = district;
        if (upazila) filter.upazila = upazila;
        const donors = await userCollection.find(filter).toArray();
        res.send(donors);
      } catch (error) {
        console.error("Error fetching donors:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });



    /****** user api *******/

    // get all users
    app.get("/users", varifyFBToken, varifyAdmin, async (req, res) => {
        const status = req.query?.status; // optional
        const page = parseInt(req.query?.page) || 1;
        const limit = parseInt(req.query?.limit) || 10;
        const skip = (page - 1) * limit;

        const query = status ? { status } : {};
        const total = await userCollection.countDocuments(query);
        const pages = Math.ceil(total / limit);
        let result = await userCollection
          .find(query)
          .sort({ createdAt: -1 }) // recent first
          .skip(skip)
          .limit(limit)
          .toArray();
        result = result.filter((user) => user.email !== req.decoded.email);
        res.send({
          users: result,
          total,
          pages,
        });
    })

    //get user role
    app.get("/users/:email/role", varifyFBToken, varifyEmail, async (req, res) => {
        const email = req.params.email;
        const query = { email };

        try {
          const user = await userCollection.findOne(query);

          if (!user) {
            return res
              .status(404)
              .send({ role: "user", message: "User not found" });
          }

          res.send({ role: user.role || "user" });
        } catch (error) {
          console.error("Error fetching user role:", error);
          res.status(500).send({ error: "Failed to get user role" });
        }
    })

    app.get("/users/:email", varifyFBToken, async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const result = await userCollection.findOne(query);
      res.send(result);
    });

    // add user after login/register
    app.post("/users", async (req, res) => {
      const user = req.body;
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    app.put("/users/:email", varifyFBToken, async (req, res) => {
      const email = req.params.email;
      const payload = req.body;
      const result = await userCollection.updateOne(
        { email: email },
        { $set: payload }
      );
      res.send(result);
    });

    app.patch("/users/:id", varifyFBToken, async (req, res) => {
      const id = req.params.id;
      const payload = req.body;
      const result = await userCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: payload }
      );
      res.send(result);
    });



    /****** donation request api *******/

    // 3 recent donation requests
    // all donation with pegination
    app.get("/donation-requests",varifyFBToken, async (req, res) => {
        const email = req.query?.email;
        const status = req.query.status; // optional
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query?.limit) || 10;
        const skip = (page - 1) * limit;

        const query = email ? { requesterEmail:email } : {};
        if (status) {
          query.status = status;
        }
        const total = await donationRequestCollection.countDocuments(query);
        const pages = Math.ceil(total / limit);

        const result = await donationRequestCollection
          .find(query)
          .sort({ createdAt: -1 }) // recent first
          .skip(skip)
          .limit(limit)
          .toArray();
        res.send({
          donations: result,
          total,
          pages,
        });
    });

    app.get("/donation-requests/:id", varifyFBToken, async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await donationRequestCollection.findOne(query);
        res.send(result);
    });

    app.post("/donation-requests", varifyFBToken, async (req, res) => {
        const donationRequest = req.body;
        // increment donationrequest count in users collection
        const filter = { email: req.decoded.email };
        const updateDoc = {
          $inc: { donationRequest: 1 },
        };
        await userCollection.updateOne(filter, updateDoc);

        const result = await donationRequestCollection.insertOne(donationRequest);
        res.send(result);
    });

    app.patch("/donation-requests/:id", varifyFBToken, async (req, res) => {
        const id = req.params.id;
        const updateDoc = req.body;
        const query = { _id: new ObjectId(id) };
        if(updateDoc?.donorEmail) {
          const filter = { email: updateDoc?.donorEmail };
          const incrementDon = {
            $inc: { donations: 1 },
            $set: { lastDonation: new Date().toISOString().split("T")[0] },
          };
          await userCollection.updateOne(filter, incrementDon);
        }
        const result = await donationRequestCollection.updateOne(query, { $set: updateDoc });
        res.send(result);
    })

    app.patch("/donation/:id", varifyFBToken, async (req, res) => {
        const id = req.params.id;
        const status = req.body.status;
        const query = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            status: status,
          },
        };
        const result = await donationRequestCollection.updateOne(query, updateDoc);
        res.send(result);
    });

    app.delete("/donation-requests/:id", varifyFBToken, async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await donationRequestCollection.deleteOne(query);
        res.send(result);
    });



    /****** blogs api *******/

    app.get("/blogs", async (req, res) => {
      const { search = "", status, category, page = 1, limit = 6 } = req.query;
      const skip = (page - 1) * limit;

      const query = {
        ...(search && { title: { $regex: search, $options: "i" } }),
        ...(status && { status }),
        ...(category && { category }),
      };
      const totalBlogs = await blogCollection.countDocuments(query);
      const totalPages = Math.ceil(totalBlogs / limit);
      const blogs = await blogCollection
        .find(query)
        .skip(skip)
        .limit(Number(limit))
        .sort({ createdAt: -1 })
        .toArray();
      res.send({
        blogs,
        totalPages
      });
    });

    app.get("/blogs/:id", varifyFBToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await blogCollection.findOne(query);
      res.send(result);
    });

    app.post("/blogs", async (req, res) => {
      const blog = req.body;
      const result = await blogCollection.insertOne(blog);
      res.send(result);
    });

    app.patch("/blogs/:id/:status", async (req, res) => {
      const id = req.params.id;
      const status = req.params.status;
      const result = await blogCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status } }
      );
      res.send(result);
    });

    app.delete("/blogs/:id", async (req, res) => {
      const id = req.params.id;
      const result = await blogCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });



    app.get('/funds',varifyFBToken, async (req, res) => {
      const {page = 1, limit = 10} = req.query;
      const skip = (page - 1) * limit;
      
      const result = await fundCollection.find().skip(skip).limit(Number(limit)).toArray();
      res.send(result);        
    });

    app.post('/funds',varifyFBToken, async (req, res) => {
      const fund = req.body;
      const result = await fundCollection.insertOne(fund);
      res.send(result);
    });



    // stripe
    app.post("/create-payment-intent", async (req, res) => {
      const { amount } = req.body;

      if (!amount || amount <= 0) {
        return res.status(400).send({ message: "Invalid amount" });
      }

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: parseInt(amount * 100), // in cents
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.send({
          clientSecret: paymentIntent.client_secret,
        });
      } catch (err) {
        console.error("Stripe error:", err);
        res.status(500).send({ error: "Failed to create payment intent" });
      }
    });

  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello from RedAid!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
