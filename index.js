const express = require('express')
const cors = require('cors')
const jwt = require('jsonwebtoken')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const nodemailer = require('nodemailer')
require('dotenv').config()
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)

const app = express()
const port = process.env.PORT || 8000

// Middlewares
const whitelist = ['http://localhost:3000', 'https://aircnc-a740e.web.app']
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || whitelist.indexOf(origin) !== -1) {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS'))
    }
  },
  credentials: true,
}
app.use(cors(corsOptions))
app.use(express.json())

// Decode JWT
function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization

  if (!authHeader) {
    return res.status(401).send({ message: 'unauthorized access' })
  }
  const token = authHeader.split(' ')[1]

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
    if (err) {
      return res.status(403).send({ message: 'Forbidden access' })
    }
    console.log(decoded)
    req.decoded = decoded
    next()
  })
}


// Database Connection
const uri = process.env.DB_URI
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
})

async function run() {
  try {
    const workCollection = client.db('todo-web').collection('work-room')
    const usersCollection = client.db('todo-web').collection('users')
    const taskCollection = client.db('todo-web').collection('task')

    // Verify Admin
    const verifyAdmin = async (req, res, next) => {
      const decodedEmail = req.decoded.email
      const query = { email: decodedEmail }
      const user = await usersCollection.findOne(query)

      if (user?.role !== 'admin') {
        return res.status(403).send({ message: 'forbidden access' })
      }
      console.log('Admin true')
      next()
    }

    // Save user email & generate JWT
    app.put('/user/:email', async (req, res) => {
      const email = req.params.email
      const user = req.body

      const filter = { email: email }
      const options = { upsert: true }
      const updateDoc = {
        $set: user,
      }
      const result = await usersCollection.updateOne(filter, updateDoc, options)

      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '1d',
      })
      console.log(result)
      res.send({ result, token })
    })

    // Get All User
    app.get('/users', verifyJWT, verifyAdmin, async (req, res) => {
      const query = {}
      const cursor = usersCollection.find(query)
      const users = await cursor.toArray()
      res.send(users)
    })

    // Get A Single User
    app.get('/user/:email', verifyJWT, async (req, res) => {
      const email = req.params.email
      const decodedEmail = req.decoded.email

      if (email !== decodedEmail) {
        return res.status(403).send({ message: 'forbidden access' })
      }
      const query = { email: email }
      const user = await usersCollection.findOne(query)
      res.send(user)
    })

    app.get("/allUsers", async (req, res) => {
      const query = {};
      const options = await usersCollection.find(query).toArray();
      res.send(options);
    });

    app.put('/users/sentInvite/:id', async (req, res) => {
      const id = req.params.id;
      const { inviterEmail, invitedEmail, inviteWorkId, inviteWorkspaceName, inviteDateTime } = req.body;
      const filter = { _id: ObjectId(id) };
      const options = { upsert: true };
      const updatedDoc = {
        $set: {
          invite: 'sentInvite',
          inviterEmail,
          invitedEmail,
          inviteWorkId,
          inviteWorkspaceName,
          inviteDateTime
        }
      };
      const result = await workCollection.updateOne(filter, updatedDoc, options);
      res.send(result);
    });
    
    app.put('/users/sentAccepted/:id', async (req, res) => {
      const id = req.params.id;
      const { acceptInviteDateTime, acceptedEmail } = req.body;
      const filter = { _id: ObjectId(id) };
      const options = { upsert: true };
    
      // Check if acceptedEmail is an array or a single email
      const updateOperations = {
        $set: {
          invite: 'accepted',
          acceptInviteDateTime
        }
      };
    
      // Ensure acceptedEmail is handled as an array
      if (Array.isArray(acceptedEmail)) {
        updateOperations.$addToSet = {
          acceptedEmails: { $each: acceptedEmail }
        };
      } else {
        updateOperations.$addToSet = {
          acceptedEmails: acceptedEmail
        };
      }
    
      updateOperations.$pull = {
        invitedEmail: { $in: Array.isArray(acceptedEmail) ? acceptedEmail : [acceptedEmail] }
      };
    
      try {
        const result = await workCollection.updateOne(filter, updateOperations, options);
        res.send(result);
      } catch (error) {
        console.error('Error updating document:', error);
        res.status(500).send('Error updating document');
      }
    });
    
    
    // app.put('/users/sentAccepted/:id', async (req, res) => {
    //   const id = req.params.id;
    //   const { acceptInviteDateTime, acceptedEmail } = req.body;
    //   const filter = { _id: ObjectId(id) };
    //   const options = { upsert: true };
    
    //   // Update the document by setting the 'invite' field to 'accepted' and removing the accepted email from 'invitedEmail'
    //   const updatedDoc = {
    //     $set: {
    //       invite: 'accepted',
    //       acceptInviteDateTime,
    //       acceptedEmail : acceptedEmail
    //     },
    //     $pull: {
    //       invitedEmail: acceptedEmail
    //     }
    //   };
    
    //   try {
    //     const result = await workCollection.updateOne(filter, updatedDoc, options);
    //     res.send(result);
    //   } catch (error) {
    //     console.error('Error updating document:', error);
    //     res.status(500).send('Error updating document');
    //   }
    // });
    

    // Get All works
    app.get('/works', async (req, res) => {
      const query = {}
      const cursor = workCollection.find(query)
      const works = await cursor.toArray()
      res.send(works)
    })

    

    // Get All works for host
    // app.get('/works/:email', verifyJWT, async (req, res) => {
    //   const email = req.params.email
    //   const decodedEmail = req.decoded.email

    //   if (email !== decodedEmail) {
    //     return res.status(403).send({ message: 'forbidden access' })
    //   }
    //   const query = {
    //     'host.email': email,
    //   }
    //   const cursor = workCollection.find(query)
    //   const works = await cursor.toArray()
    //   res.send(works)
    // })

    // Get Single Home
 

   

    app.get("/worksInvited/:invitedEmail", async (req, res) => {
      const invitedEmail = req.params.invitedEmail;
      const query = { invitedEmail: invitedEmail };
      const user = await workCollection.find(query).toArray();
      res.send(user);
    });
    app.get("/acceptedEmails/:acceptedEmails", async (req, res) => {
      const acceptedEmails = req.params.acceptedEmails;
      const query = { acceptedEmails: acceptedEmails };
      const user = await workCollection.find(query).toArray();
      res.send(user);
    });

    app.get("/works/:UserEmail", async (req, res) => {
      const UserEmail = req.params.UserEmail;
      const query = { UserEmail: UserEmail };
      const user = await workCollection.find(query).toArray();
      res.send(user);
    });

    // Delete a home
    app.delete('/home/:id', verifyJWT, async (req, res) => {
      const id = req.params.id
      const query = { _id: ObjectId(id) }
      const result = await workCollection.deleteOne(query)
      res.send(result)
    })

    // Update A Home
    app.put('/works', verifyJWT, async (req, res) => {
      const home = req.body
      console.log(home)

      const filter = {}
      const options = { upsert: true }
      const updateDoc = {
        $set: home,
      }
      const result = await workCollection.updateOne(filter, updateDoc, options)
      res.send(result)
    })

    // Post A Home
    app.post('/works', verifyJWT, async (req, res) => {
      const home = req.body
      console.log(home)
      const result = await workCollection.insertOne(home)
      res.send(result)
    })

    // Get search result
    app.get('/search-result', async (req, res) => {
      const query = {}
      const location = req.query.location
      if (location) query.location = location

      console.log(query)
      const cursor = workCollection.find(query)
      const works = await cursor.toArray()
      res.send(works)
    })
    app.get('/home/:id', async (req, res) => {
      const id = req.params.id
      const query = { _id: ObjectId(id) }
      const home = await workCollection.findOne(query)
      res.send(home)
    })

        ////////////////////// Comment  Start//////////////////////////
    app.post("/task", async (req, res) => {
      const order = req.body;
      const result = await taskCollection.insertOne(order);
      res.send(result);
    });
    app.delete("/task/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) };
      const result = await taskCollection.deleteOne(query);
      res.send(result);
    });
    app.get("/task", (req, res) => {
      // Assuming tutorReq is a MongoDB collection
      const cursor = taskCollection.find({});

      res.setHeader("Content-Type", "application/json");
      res.write("[");

      let isFirstChunk = true;
      cursor
        .stream()
        .on("data", (doc) => {
          if (!isFirstChunk) {
            res.write(",");
          }
          res.write(JSON.stringify(doc));
          isFirstChunk = false;
        })
        .on("end", () => {
          res.write("]");
          res.end();
        });
    });
    app.get("/task/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) };
      const result = await taskCollection.findOne(query);
      res.send(result);
    });

      app.get("/taskNewData", async (req, res) => {
      // Use the find method to get only shortlisted entries
      const taskNewData = await taskCollection
        .find({ taskMove:"new" })
        .toArray();

      res.send(taskNewData);
    });
      app.get("/taskOngoingData", async (req, res) => {
      // Use the find method to get only shortlisted entries
      const taskNewData = await taskCollection
        .find({ taskMove:"ongoing" })
        .toArray();

      res.send(taskNewData);
    });
      app.get("/taskDoneData", async (req, res) => {
      // Use the find method to get only shortlisted entries
      const taskNewData = await taskCollection
        .find({ taskMove:"done" })
        .toArray();

      res.send(taskNewData);
    });


    //////////// task handler start ///////////
    app.put("/task/ongoing/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: ObjectId(id) };
      const options = { upsert: true };
      const updatedDoc = {
        $set: {
          taskMove:"ongoing",
        },
      };
      const result = await taskCollection.updateOne(
        filter,
        updatedDoc,
        options
      );
      res.send(result);
    });

    app.put("/task/done/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: ObjectId(id) };
      const options = { upsert: true };
      const updatedDoc = {
        $set: {
          taskMove:"done",
        },
      };
      const result = await taskCollection.updateOne(
        filter,
        updatedDoc,
        options
      );
      res.send(result);
    });
    //////////// task handler end  ///////////

    ////////////////////// Comment  END  //////////////////////////

    console.log('Database Connected...')
    console.log(uri);
  } finally {
  }
}

run().catch(err => console.error(err))

app.get('/', (req, res) => {
  res.send('Server is running... in session')
})

app.listen(port, () => {
  console.log(`Server is running...on ${port}`)
})
