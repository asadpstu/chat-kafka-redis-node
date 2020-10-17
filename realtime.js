var express = require('express'); 
var app = express();

var server = require('http').createServer(app);
var io = require('socket.io')(server);
var kafka = require('kafka-node');
var users = [];
app.use('/', express.static(__dirname + '/')); 

app.get('/send', function (req, res) {
    var msg=req.query.msg;
    var Producer = kafka.Producer,
    client = new kafka.KafkaClient('localhost:2181'),
    producer = new Producer(client);
    payloads = [
        { topic: 'AfterFix', messages: msg, partition: 0 },
    ];
    producer.on('ready', function(){
        producer.send(payloads, function(err, data){
            console.log("Firing Producer...");
            //io.sockets.emit('server_counter',data);
        });
    });
    producer.on('error', function(err){})
    
    res.send('输入消息='+msg);
 })
server.listen(8080);


setTimeout(function(){
    var Consumer = kafka.Consumer;
    var Offset = kafka.Offset;
    var topic = 'AfterFix';

    var client = new kafka.KafkaClient('localhost:2181');//'localhost:2181'
    var topics = [{ topic: topic, partition: 0 }];
    var options = { autoCommit: false };//, fetchMaxWaitMs: 1000, fetchMaxBytes: 1024 * 1024

    var consumer = new Consumer(client, topics, options);
    var offset = new Offset(client);
    consumer.on('message', function (message) {
        console.log("Firing Consumer ...");
        io.sockets.emit('server_counter',message);
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
    
},1000);