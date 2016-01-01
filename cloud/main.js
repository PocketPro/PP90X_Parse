// Match State
const PPMatchStatePending = "pending";
const PPMatchStateActive = "active";
const PPMatchStateFinished = "finished";
const PPMatchStateDeclined = "declined";
const PPMatchStateResigned = "resigned";
const PPMatchStateTimedOut = "timedOut";

// Match Types
const PPMatchTypeRandom = "random";

/**
* If the PPMatch is new and matchType is PPMatchTypeRandom, a random opponent is matched 
* and the opponent receives a push notification. If the PPMatch is not new and either the 
* state or player scores have changed, a push notification will be sent.
*/
Parse.Cloud.beforeSave("PPMatch", function(request, response) {
	
	var match = request.object;
	var matchType = match.get("matchType");	
	var state = match.get("state");
	
	
	var promises = [];
	if (match.isNew() && matchType == PPMatchTypeRandom) {
		randomPartnerForMatch(match).then(function(player2) {
			match.set("player2", player2);
			promises.push(pushNotificationForMatch(match, PPPushNotificationTypeMatchPending, player2));
		},
		function(error) {
			response.reject(error);
		});
	}
	else {

		if (match.dirty("player1Scores") || match.dirty("player2Scores")) {
			var nextToAct = nextPlayerToActForMatch(match);
			if (nextToAct && request.user != nextToAct) {
				promises.push(pushNotificationForMatch(match, PPPushNotificationTypeNextToAct, nextToAct));
			}
		}	
	
		if (match.dirty("state")) {
			if (state === PPMatchStateActive) {
				promises.push(pushNotificationForMatch(match, PPPushNotificationTypeMatchAccepted, match.get("player1")));	
			}
			else if (state === PPMatchStateDeclined) {
				promises.push(pushNotificationForMatch(match, PPPushNotificationTypeMatchDeclined, match.get("player1")));	
			}
			else if (state === PPMatchStateFinished) {
				var recipients = [match.get("player1"), match.get("player2")].remove(request.user);
				for (player in recipients) {
					promises.push(pushNotificationForMatch(match, PPPushNotificationTypeMatchFinished, player));
				}
			}
			else if (state === PPMatchStateResigned) {
				promises.push(pushNotificationForMatch(match, PPPushNotificationTypeMatchResigned, match.get("winner")));
			}
			else if (state === PPMatchStateTimedOut) {
				promises.push(pushNotificationForMatch(match, PPPushNotificationTypeMatchTimedOut, match.get("player1")));
				promises.push(pushNotificationForMatch(match, PPPushNotificationTypeMatchTimedOut, match.get("player2")));
			}
		}
	}
	
	Parse.Promise.when(promises).then(function() {
		response.success();
	});
});

/****************************************************************************************
PUSH METHODS
****************************************************************************************/

// Push Notification Types
const PPPushNotificationTypeMatchPending = "pending"; 	// should only be sent to player2.
const PPPushNotificationTypeMatchAccepted = "accepted"; // should only be sent to player1.
const PPPushNotificationTypeMatchDeclined = "declined"; // should only be sent to player2.
const PPPushNotificationTypeMatchResigned = "resigned"; // should only be sent to the winning player.
const PPPushNotificationTypeMatchTimedOut = "timedOut"; // may be sent to either player1 or player2.
const PPPushNotificationTypeMatchFinished = "finished"; // should only be sent to the 'other' player.
const PPPushNotificationTypeNextToAct = "next"; 		// should only be sent to the 'next-to-act' player.

/**
* Returns a promise to deliver the a push notification of a given type to a given player
* in a given match.
* @param match the match object.
* @param type the type of push notification to send. Refer to the list of constants 
* defined earlier.
* @param player the recipient of the push notification.
*/
function pushNotificationForMatch(match, type, player) {

	console.log("pushNotificationForMatch(" + match.id + ", " + type + ", " + player.id + ")");

	var promise = messageBodyForMatch(match, type, player).then(function(messageBody) {
		
		// Installation query
		var query = new Parse.Query(Parse.Installation);
		query.equalTo("user", player)
	
		// Push promise
		var promise = Parse.Push.send({
			where: query,
			data: {
				alert: messageBody
			}
		},
		{
			success: function() {
				console.log("Push notification(s) delivered to " + player.id + " for match " + match.id + ".");
			},
			error: function(error) {
				console.error(error);
			}
		});
		
	});

	return promise;
}

/**
* Returns a promise for to compose message body for a push notification of the specified type.
* @param match the match object
* @param type the push notification type
* @param player the recipient of the push notification
*/
function messageBodyForMatch(match, type, player) {

	console.log("messageBodyForMatch(" + match.id + ", " + type + ", " + player.id + ")");

	var otherPlayer = [match.get("player1"), match.get("player2")].remove(player)[0];

	var promise = otherPlayer.fetch({useMasterKey: true}).then(function(user){
		
		var otherPlayerName = user.get("name");
		if (!otherPlayerName) {
			console.log("otherPlayerName is null");
		}
		
		// Compose the body.
		var messageBody = null;
		if (PPPushNotificationTypeMatchPending === type) {
			messageBody = otherPlayerName + " has challenged you to a match!";
		}	
		else if (PPPushNotificationTypeMatchAccepted === type) {
			messageBody = otherPlayerName + " accepted your challenge!";
		}	
		else if (PPPushNotificationTypeMatchDeclined === type) {
			messageBody = otherPlayerName + " declined your challenge!";
		}
		else if (PPPushNotificationTypeMatchResigned === type) {
			messageBody = otherPlayerName + " resigned the match. You win!";
		}
		else if (PPPushNotificationTypeMatchTimedOut === type) {
			var winBody = otherPlayerName + " timed out. You win!";
			var loseBody = "Your move vs. " + otherPlayerName + "has timed out. You lose.";
			messageBody = (match.get("winner") === player) ? winBody : loseBody;
		}
		else if (PPPushNotificationTypeMatchFinished === type) {
			var winBody = "You've won vs " + otherPlayerName + "!";
			var loseBody = "You've lost vs. " + otherPlayerName + "!";
			messageBody = (match.get("winner") === player) ? winBody : loseBody;
		}
		else if (PPPushNotificationTypeNextToAct === type) {
			messageBody = "It's your turn vs. " + otherPlayerName + ".";
		}
		else {
			console.error("Unrecognized push notification type " + type + " in declinedPushNotificationForMatch(match,type)");
		}
		
		console.log(messageBody);
		return Parse.Promise.as(messageBody);
	});

	return promise;
}

/****************************************************************************************
MATCH FUNCTIONS
****************************************************************************************/
/**
* Returns the next player to act for the given match. Returns null if the game is finished.
*/
function nextPlayerToActForMatch(match) {	
	
	if (isMatchFinished(match)) {
		return null;
	}
	
	var state = match.get("state");
	var player1 = match.get("player1");
	var player2 = match.get("player2");
	
	var nextToAct = null;
	
	if (state === PPMatchStatePending) {
		nextToAct = player2;
	}
	else  {
		
		var player1Scores = match.get("player1Scores");
		var player2Scores = match.get("player2Scores");
		
		if (player1Scores.length == player2Scores.length) {
			p1LastScore = player1Scores[player1Scores.length - 1];
			p2LastScore = player2Scores[player1Scores.length - 1];
			nextToAct = (p1LastScore <= p2LastScore) ? player1 : player2;
		}
		else {
			nextToAct = (player1Scores.length < player2Scores.length) ? player1 : player2;
		}
	}
	
	return nextToAct;
}

/**
* Returns true if the match is finished, false otherwise.
*/
function isMatchFinished(match) {
	var state = match.get("state");
	if (state === PPMatchStateFinished 
		|| state === PPMatchStateDeclined
		|| state === PPMatchStateResigned 
		|| state === PPMatchStateTimedOut) {
		return true;			
	}
	else {
		return false;
	}
}
 

/**
Returns a promise to find an opponent for player1 in the given match.
@param match a PPMatch object.
*/
function randomPartnerForMatch(match) {

	var player1 = match.get("player1")
	var query = new Parse.Query(Parse.User).notEqualTo("id", player1.id)
	var promise = query.find().then(function(results) {
		if (results.length == 0) {
			return Parse.Promise.error("There are no other players. Sorry :(");
		}
		else {
			var index = Math.floor(Math.random() * results.length)
			var player2 = results[index]
			return Parse.Promise.as(player2);	
		}	
	},
	function(error) {
		return Parse.Promise.error("Failed finding other users in randomPartnerForMatch");
	});
	
	return promise;
}


/****************************************************************************************
OTHER FUNCTIONS
****************************************************************************************/

/**
* A convenience function to help in adding match scores. player1Scores.reduce(add, 0).
*/
function add(a, b) {
    return a + b;
}

/**
* Returns a new array with the passed in objects removed.
*/
Array.prototype.remove = function() {
    var what, a = arguments, L = a.length, ax;
    while (L && this.length) {
        what = a[--L];
        while ((ax = this.indexOf(what)) !== -1) {
            this.splice(ax, 1);
        }
    }
    return this;
};

Parse.Cloud.define("testMessageBody", function(request, response) {
	
});