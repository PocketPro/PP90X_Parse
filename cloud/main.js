
const PPMatchStatePending = "pending";
const PPMatchStateActive = "active";
const PPMatchStateFinished = "finished";
const PPMatchStateDeclined = "declined";
const PPMatchStateResigned = "resigned";
const PPMatchStateTimedOut = "timedOut";

const PPMatchTypeRandom = "random";

/**
* 
*/
Parse.Cloud.beforeSave("PPMatch", function(request, response) {
	
	var match = request.object;
	var matchType = request.get("matchType");	
	var state = match.get("state");
	
	if (state === PPMatchStatePending) {
		if (matchType === PPMatchTypeRandom) {
			
			randomPartnerForMatch(request.object).then(function(player2) {
				request.object.set("player2", player2);
				response.success();
			},
			function(error) {
				response.reject(error);
			});
			
		}
	} 
	
});

/**
* Send a push notification to the next player to act.
*/
Parse.Cloud.afterSave("PPMatch", function(request, response) {
	
	var match = request.object;
	var player = nextPlayerToActForMatch(match);
	
	var query = new Parse.Query(Parse.Installation);
	query.equalTo("user", player)
	Parse.Push.send({
		where: query,
		data: {
			alert: "It's your turn!"
		}
	},
	{
  		success: function() {
    		response.success();
  		},
  		error: function(error) {
    		response.reject(error);
  		}
	});
});

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

function add(a, b) {
    return a + b;
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
			return Parse.promise.as(player2);	
		}	
	},
	function(error) {
		return Parse.Promise.error("Failed finding other users in randomPartnerForMatch");
	});
	
	return promise;
}
