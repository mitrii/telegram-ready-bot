require('total.js');

var TelegramBot = require('node-telegram-bot-api'), 
	  moment = require('moment'),
    sprintf = require("sprintf-js").sprintf,
    vsprintf = require("sprintf-js").vsprintf,
    redis = require("redis"),
    fs = moment = require('fs');

var utils = require('total.js/utils');
var config = fs.readFileSync('bot-params').toString('utf8').parseConfig();
    
var rc = redis.createClient();

rc.on("error", function (err) {
    console.log("Error " + err);
});
 
// if you'd like to select database 3, instead of 0 (default), call 
// client.select(3, function() { /* ... */ }); 

 
var token = config.telegram_key;

// Setup polling way
var bot = new TelegramBot(token, {polling: true, interval: 200});
bot.getMe().then(function (me) {
  console.log('Start bot %s', me.username);
});

var messages = {
    start_new: 'Голосование открыто',
    already_exists: 'Голосование уже запущено, выполните команду /stop для отмены',
    stop_lobby: 'Голосование завершено',
    go: 'GO GO GO',
    counts: '%(curr_count)d из %(count)d готовы',
    timeout: 'Время на исходе, осталось %(time)d секунд. Необходимо еще %(curr_need)d из %(count)d',
    late: 'Не успел, голосование завершено. Sad but true.',
    please_start_new: 'Похоже, что еще никто не запустил голосование командой /new',
    minus: 'Отказ принят.',
    result: 'Кто готов: %s',
    result_kicker: '🔵%(left)s VS 🔴%(right)s',
    whos_ready: 'Кто готов: %s',
    stop_by_not_creator: 'Только создатель голосования может его отменить'
}

function shuffle(o){
    for(var j, x, i = o.length; i; j = Math.floor(Math.random() * i), x = o[--i], o[i] = o[j], o[j] = x);
    return o;
}

function user_to_str(usr)
{    
    if(usr.hasOwnProperty('username')){
        return JSON.stringify({id: usr.id, name: '@'+usr.username});
    }
    else {
        return JSON.stringify({id: usr.id, name: usr.first_name});
    }
}

function get_ops(msg, callback)
{   
    rc.get("ops_"+msg.chat.id, callback); 
}

function get_votes(msg, callback)
{
    rc.smembers("list_"+msg.chat.id, function(err, res){
        var votes = [];
        res.forEach(function(user, index){
          user = JSON.parse(user);
          votes.push(user.name);     
        });
        
        callback(votes);
    });
}

function show_result(msg)
{   
    get_votes(msg, function(players){        
        players = shuffle(players);
        
        var half_players = Math.ceil(players.length / 2);    
        var left_players = players.slice(0,half_players);
        var right_players = players.slice(half_players);
        
        bot.sendMessage(msg.chat.id, sprintf(messages.result_kicker, {left: left_players.join(', '), right: right_players.join(', ')}));
    });
}

function del(msg)
{
    rc.del(["list_"+msg.chat.id, "ops_"+msg.chat.id], function(){
        bot.sendMessage(msg.chat.id, messages.stop_lobby);
    });
}

function who(msg)
{
    get_votes(msg, function(players){
        bot.sendMessage(msg.chat.id, sprintf(messages.whos_ready, players.join(', ')));       
    });
}

function timeout(msg, time)
{
    get_votes(msg, function(players){        
        get_ops(msg, function(err, res){
            var ops = JSON.parse(res);
            if (players.length < ops.count)  {
                bot.sendMessage(msg.chat.id, sprintf(messages.timeout, {time: time, curr_need: ops.count - players.length, count: ops.count}));
                setTimeout(function(){del(msg)}, time * 1000);
            }
            else
            {
                del(msg);
            }  
        });       
    });
}

function stop(msg)
{   
    get_ops(msg, function(err, res){
        var ops = JSON.parse(res);
      
        if (ops.creator == msg.from.id) 
            del(msg);
        else 
            bot.sendMessage(msg.chat.id, messages.stop_by_not_creator);    
    });
    
    
}

function plus(msg)
{
    var chat_id = msg.chat.id,
        from_id = msg.from.id,
        msg_id  = msg.message_id;
    
    get_ops(msg, function(err, res){
          
      if (res) {
        rc.scard("list_"+chat_id, function(err, curr_count){
            var ops = JSON.parse(res);

            if (curr_count < ops.count) {
                rc.sadd("list_"+chat_id, user_to_str(msg.from), function(err, res){
                    if (res) curr_count++;
              
                   
                    bot.sendMessage(chat_id, sprintf(messages.counts, {curr_count: curr_count, count: ops.count}));
                    if (curr_count >= ops.count)  {
                         setTimeout(function(){show_result(msg)}, 1000);
                    }

                });  
                
            }            
            else {
                bot.sendMessage(chat_id, messages.late, {reply_to_message_id: msg_id});
            }  
        });       

      }
      else {
        bot.sendMessage(chat_id, messages.please_start_new, {reply_to_message_id: msg_id});
      }      

      
    });  
}

function minus(msg)
{
    var chat_id = msg.chat.id,
        from_id = msg.from.id,
        msg_id  = msg.message_id;
    
    rc.srem("list_"+chat_id, user_to_str(msg.from), function(err, res){
        if (res) bot.sendMessage(chat_id, messages.minus); 
        /*
        rc.scard("list_"+chat_id, function(err, curr_count){
            var ops = JSON.parse(res);
            bot.sendMessage(chat_id, sprintf(messages.counts, {curr_count: curr_count, count: ops.count}));
        }); 
        */
    });
}

function start(msg, count, rnd, max_time, split, title)
{
    
    var chat_id = msg.chat.id,
        from_id = msg.from.id,
        msg_id  = msg.message_id;
    
    count = typeof count !== 'undefined' ? count : 4;
    rnd = typeof rnd !== 'undefined' ? rnd : false;
    max_time = typeof max_time !== 'undefined' ? max_time : 300;
    split = typeof split !== 'undefined' ? split : 300;
    title = typeof title !== 'undefined' ? title : messages.start_new;
    
    var ops = {
        count: count, 
        rnd: rnd, 
        max_time: max_time, 
        split: split,
        creator: from_id,
        title: title,
        //start_time: 
    };
    var exists = false;
   
    
    rc.exists("list_"+chat_id, function(err, res){
      exists = res;
     
      
      if (exists) {
        bot.sendMessage(chat_id, messages.already_exists);
      }
      else {
        rc.append("ops_"+chat_id, JSON.stringify(ops), function(err, res){
            
           
            var timeout_val = (max_time-30) * 1000;
            
            setTimeout(function(){timeout(msg, 30)}, timeout_val);
            
            plus(msg)
        });
        
        
        var reply_keyboard = {
            keyboard:[['+', '-']],
            one_time_keyboard: true
        }
        
        bot.sendMessage(chat_id, title, {reply_markup: JSON.stringify(reply_keyboard)});
      }     

    });
}

// echo
bot.onText(/\/echo (.+)/, function (msg, match) {
  var fromId = msg.from.id;
  var resp = match[1];
  
  bot.sendMessage(fromId, resp);
});


bot.on('message', function (msg, match) {
      
  // new
  if (msg.text.startsWith('/new'))
  {
      start(msg);
  }
  
  //rnd
  if (msg.text.startsWith('/rnd') || msg.text.startsWith('/random'))
  {
      show_result(msg)
  }
  
  // kicker
  if (msg.text.startsWith('/kicker'))
  {
      start(msg, 4, true, 300, true, 'Кто в кикер?');
  }
  
  // csgo
  if (msg.text.startsWith('/csgo'))
  {
      start(msg, 5, false, 600, false);
  }
  
  // stop
  if (msg.text.startsWith('/stop'))
  {
      stop(msg);
  }
  
  // +
  if (msg.text == '/+' || msg.text == '+')
  {
      plus(msg)
  }
  
  // -
  if (msg.text == '/-' || msg.text == '-')
  {
      minus(msg)
  }
  
});