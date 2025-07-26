require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");
const app = express();
const port = process.env.PORT || 9000;
const admin = require("firebase-admin");

app.use(cors());
app.use(express.json());



const serviceAccount = require("./red--aid-firebase-admin-key.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.rydkrvl.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );

    const userCollection = client.db("redAid").collection("users");
    const donationRequestCollection = client.db("redAid").collection("donationRequests");



    /****** middleware *******/

    const varifyFBToken = async (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).send({ message: "Unauthorized Access1" });
      }

      const token = authHeader.split(" ")[1];
      if (!token) {
        return res.status(401).send({ message: "Unauthorized Access2" });
      }

      try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded = decoded;
        next();
      } catch (error) {
        return res.status(403).send({ message: "Forbidden Access3" });
      }
    };


    /****** user api *******/

    // get all users
    app.get("/users", async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    })

    //get user role
    app.get("/users/:email/role", varifyFBToken, async (req, res) => {
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



    /****** donation request api *******/

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
