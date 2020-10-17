var express = require('express');
var kafka = require('kafka-node');
var app = express();
var http = require('http').Server(app);

var io = require('socket.io')(http);

var redis = require('redis');
var clientRedis = redis.createClient(6379, 'localhost', {no_ready_check: true});



var bodyParser = require('body-parser');
var constants = require('./constants');

//Variable declaration
var userPool = [];
var userPoolTemp = [];

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
  extended: true
}));


app.get('/connect', function (req, res) {
  res.sendfile('client.html');
});


app.get('/', function (req, res) {
  res.json({ success: 'Kafka Chat service is running' })
});

/*-------------------------------------Producer--------------------------------*/

var Producer = kafka.Producer,
  client = new kafka.KafkaClient(),
  producer = new Producer(client);


// producer.on('ready', function () {
//   producer.createTopics([
//     constants.TOPIC_CHAT
//   ], false, function (err, data) {
//     if (err) { console.log(err) }
//   });
//   console.log('Kafka client is ready');
// });

var topicsToCreate = [{
  topic: constants.TOPIC_CHAT,
  partitions: 5,
  replicationFactor: 3,
  // Optional set of config entries
  configEntries: [
    {
      name: 'retention.ms',
      value: '1000'
    }
  ]
}];



producer.on('ready', function () {
  client.createTopics(topicsToCreate, (error, result) => {
    if(error) throw error;
    else console.log('Kafka client is ready');
  });
});


producer.on('error', function (err) {
  console.log('Kafka client is in an error state: ');
});



/*-----------------------------------Socket---------------------------*/

io.on('connection', socket => {
  socket.on("new-user", userId => {
    userPool[socket.id] = userId;
    userPoolTemp.push({
      "socketId": socket.id,
      "userId": userId
    })
  })

  socket.on('disconnect', function () {
    for (var i = 0; i < userPoolTemp.length; i++) {
      if (userPoolTemp[i]["socketId"] === socket.id) {
        userPoolTemp.splice(i, 1);;
      }
    }
    delete userPool[socket.id];
  });

  socket.on("send-message", data => {
    var isOnline = false;
    for (var i = 0; i < userPoolTemp.length; i++) {
      if (userPoolTemp[i]["userId"] === data.receiver) {
        var receiverSocketId = userPoolTemp[i].socketId;
        isOnline = true;
      }
    }
    var messageBody = {};
    if (isOnline === true) {
      messageBody = {
        "message": data.message,
        "receiver": data.receiver, //Unique Identity
        "from": data.from,
        "datetime": new Date(),
        "online": isOnline,
        "receiverSocketId": receiverSocketId, //For Instant message
        "isGroup": false
      }
    }
    else {
      messageBody = {
        "message": data.message,
        "receiver": data.receiver,  //Unique Identity
        "from": data.from,
        "datetime": new Date(),
        "online": isOnline,
        "receiverSocketId": "n/a",  //Sign for saving data to remote storage
        "isGroup": false
      }
    }



    var msg = JSON.stringify(messageBody);

    payloads = [{ topic: constants.TOPIC_CHAT, messages: msg, partition: 0 }];
    producer.send(payloads, function (err, data) {
      console.log("Producer received the pay load!");
    });

  })


  //Join Group socket connection  ==>tomorrow
  var groupInfo = ["Sales-Work", "IT-Work", "Markating-Work"];
  socket.on("join-group", data => {
    if (groupInfo.indexOf(data.groupName) !== -1) {
      socket.join(data.groupName);
      console.log(data.memberName + 'joined the room:' + data.groupName);
    }
  })


  socket.on("send-message-group", data => {
    var messageBody = {};
    messageBody = {
      "message": data.messageGroup,
      "receiver": data.receiverGroup,
      "from": data.from,
      "datetime": new Date(),
      "isGroup": true
    }

    var msg = JSON.stringify(messageBody);
    payloads = [{ topic: constants.TOPIC_CHAT, messages: msg, partition: 0 }];
    
    producer.send(payloads, function (err, data) {
      console.log("Producer received the pay load for Group chat!");
    });


    //If not to use Kafka
    //io.to(messageBody.receiver).emit('Send-to-group', messageBody);

  })


  //missing message getting from redis
  socket.on("missed-message", (userId)=>{

    console.log(userPool)
    console.log(userPoolTemp)
    console.log("requester socket id : " + socket.id)

    clientRedis.send_command("SCAN", [0,"MATCH", userId+":*" ], function(err, reply) {
      for (var i = 0; i < reply.length; i++) 
      {
          for(var j=0;j<reply[i].length;j++)
          {
            
            var key = reply[i][j];
            clientRedis.hgetall(reply[i][j], function(err, object) {
              console.log(object);
              io.sockets.to(socket.id).emit('sending-missed-message', object);
              clientRedis.del(key);
            });
            
          }
      }
  
   });



  })


});


/*-----------------------------------------Redis------------------------------------------*/
clientRedis.on('error', function (err) {
  console.log('Error ' + err);
}); 

clientRedis.on('connect', function() {
  console.log('Connected to Redis');
});



/*-----------------------------------------Consumer---------------------------------------*/

setTimeout(function () {
  var Consumer = kafka.Consumer;
  var Offset = kafka.Offset;
  var topic = constants.TOPIC_CHAT;

  var client = new kafka.KafkaClient('localhost:2181');//'localhost:2181'
  var topics = [{ topic: topic, partition: 0 }];
  var options = { autoCommit: false };//, fetchMaxWaitMs: 1000, fetchMaxBytes: 1024 * 1024

  var consumer = new Consumer(client, topics, options);
  var offset = new Offset(client);


  consumer.on('message', function (message) {
    //console.log("----------------------------------------------------------------------")
    //console.log(message.value);
    //console.log("----------------------------------------------------------------------")
    var msgMakeStr = message.value;
    var msg = JSON.parse(msgMakeStr);
    var messageBody = {};
    if (msg.isGroup === true) //For Group Message
    {
      messageBody = {
        "message": msg.message,
        "receiver": msg.receiver,
        "from": msg.from,
        "datetime": msg.datetime,
        "isGroup": msg.isGroup,
      }
    }
    else  // For one to one message 
    {
      messageBody = {
        "message": msg.message,
        "receiver": msg.receiver,
        "from": msg.from,
        "datetime": msg.datetime,
        "isGroup": msg.isGroup,
        "online": msg.online,
        "receiverSocketId": msg.receiverSocketId
      }

    }


    if (messageBody.isGroup === true) {
      io.sockets.to(messageBody.receiver).emit('Send-to-group', msg);
    }

    if (messageBody.isGroup === false) {
      if (messageBody.online === true) {
        io.sockets.to(messageBody.receiverSocketId).emit("message-receive", messageBody);
      }
      else 
      {
        console.log("Not sending msg.storing in kafka.")
        clientRedis.hmset(msg.receiver+":"+msg.datetime , messageBody);
        
      }

    }

    console.log("data received to Kafka end!");

  });

  consumer.on('error', function (err) {
    console.log('error', err);
  });
  consumer.on('offsetOutOfRange', function (topic) {
    topic.maxNum = 2;
    offset.fetch([topic], function (err, offsets) {
      if (err) {
        return console.error(err);
      }
      var min = Math.min.apply(null, offsets[topic.topic][topic.partition]);
      consumer.setOffset(topic.topic, topic.partition, min);
    });
  });



}, 1000);


// start server
http.listen(5001, function () {
  console.log('listening on *:5001');
});
