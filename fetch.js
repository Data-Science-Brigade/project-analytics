var fs = require('fs');

var _ = require('lodash');
var moment = require('moment');
var request = require('request');

var MILLISECONDS_IN_A_DAY = 1000 * 60 * 60 * 24;
var DATE_FORMAT = 'YYYY-MM-DD';
var MILESTONE_FILE = 'data/milestones.js';

var TOKEN = process.env.CLUBHOUSE_API_TOKEN;

function fetchMilestones(callback) {
  request({
    url: 'https://api.clubhouse.io/api/v3/milestones?token=' + TOKEN,
    json: true
  }, callback);
}

function fetchMilestoneEpics(milestoneID, callback) {
  request({
    url: 'https://api.clubhouse.io/api/v3/milestones/' + milestoneID + '/epics?token=' + TOKEN,
    json: true
  }, callback);
}

function fetchCompletedStoriesForEpic(epicName, callback) {
  request({
    url: 'https://api.clubhouse.io/api/v3/search/stories?token=' + TOKEN,
    method: 'GET',
    json: true,
    body: { query: 'epic:"' + epicName + '"' }
  }, callback);
}

function fetchCompletedStoriesForMilestone(milestoneID, callback) {
  request({
    url: 'https://api.clubhouse.io/api/v3/search/stories?token=' + TOKEN,
    method: 'POST',
    json: true,
    body: { archived: false, milestone_ids: [milestoneID], workflow_state_types: ['done'] }
  }, callback);
}

function createDateRange(fromDate, toDate) {
  var stack = [];
  var fromMoment = moment(fromDate);
  var toMoment = moment(toDate);

  while (fromMoment.isBefore(toMoment) || fromMoment.isSame(toMoment, 'days')) {
    stack.push(fromMoment.format(DATE_FORMAT));
    fromMoment = fromMoment.add(1, 'days');
  }

  return stack;
}

function storiesToCompletedTimestamps(stories) {
  return _.map(stories, function (story) {
    return new Date(story.created_at).getTime();
  });
}

function calculateDateRangeForStories(stories) {
  var timestamps = storiesToCompletedTimestamps(stories);
  var fromDate = _.min(timestamps);
  var toDate = _.max(timestamps);

  return createDateRange(fromDate, toDate);
}

function calculateStoryRatioData(stories, dateRange) {
  var data = 'Data.StoryTypeRatios = [\n';
  var totals = {
    feature: 0,
    bug: 0,
    chore: 0,
    total: 0
  };

  _.each(dateRange, function (day) {
    _.each(stories, function (story) {
      // Measure by points:
      // if (story.estimate) {
      //   totals[story.story_type] += story.estimate;
      // }
      if (story.completed && story.completed_at.split('T')[0] === day) {
        // Measure by story count:
        totals[story.story_type] += 1;
        totals.total += 1;
      }
    });
    data += '  [new Date("' + day + '"), ' + (totals.feature / totals.total) + ', ' + (totals.bug / totals.total) + ', ' + (totals.chore / totals.total) + '],\n';
  });

  data += '];\n';

  return data;
}

function calculateStoryTypeData(stories, dateRange) {
  var data = 'Data.StoryTypeData = [\n';
  var totals = {
    feature: 0,
    bug: 0,
    chore: 0
  };

  _.each(dateRange, function (day) {
    _.each(stories, function (story) {
      // Measure by points:
      // if (story.estimate) {
      //   totals[story.story_type] += story.estimate;
      // }
      if (story.completed && story.completed_at.split('T')[0] === day) {
        // Measure by story count:
        totals[story.story_type] += 1;
      }
    });
    data += '  [new Date("' + day + '"), ' + totals.feature + ', ' + totals.bug + ', ' + totals.chore + '],\n';
  });

  data += '];\n';

  return data;
}

function calculateMonthlyVelocityChartData(stories, dateRange) {
  var data = 'Data.MonthlyVelocityChart = [\n';
  var velocity = 0;

  _.each(dateRange, function (day) {
    _.each(stories, function (story) {
      // Measure by points:
      // if (story.estimate) {
      //   velocity += story.estimate;
      // }
      if (story.completed && story.completed_at.split('T')[0] === day) {
        // Measure by story count:
        velocity += 1;
      }
    });

    if (day.split('-')[2] === '01') {
      data += '  [new Date("' + day + '"), ' + velocity + '],\n';
      velocity = 0;
    }
  });

  data += '];\n';

  return data;
}

function calculateCycleTimeChartData(stories, dateRange) {
  var data = 'Data.CycleTimeChart = [\n';
  var cycleTimes = [];

  _.each(dateRange, function (day) {
    _.each(stories, function (story) {
      if (story.completed) {
      if (story.completed_at.split('T')[0] === day) {
        var cycleTime = (new Date(story.completed_at).getTime() - new Date(story.started_at).getTime()) / MILLISECONDS_IN_A_DAY;

        cycleTimes.push(cycleTime);
      }
    }
    });

    if (day.split('-')[2] === '01') {
      data += '  [new Date("' + day + '"), ' + _.max(cycleTimes) + ', ' + _.mean(cycleTimes) + ', ' + _.min(cycleTimes) + '],\n';
      cycleTimes = [];
    }
  });

  data += '];\n';

  return data;
}

function calculateEstimateChartData(stories) {
  var estimates = { None: 0 };

  _.each(stories, function (story) {
    var estimate = _.isNumber(story.estimate) ? story.estimate : 'None';

    if (estimates[estimate]) {
      estimates[estimate]++;
    } else {
      estimates[estimate] = 1;
    }
  });

  var data = 'Data.EstimateChart = ' + JSON.stringify(estimates) + ';\n';

  return data;
}

function compileChartData(stories, milestone) {
  console.log('Compiling story data...');
  stories = _.sortBy(stories, function (story) {
    return new Date(story.completed_at).getTime();
  });

  var dateRange = calculateDateRangeForStories(stories);
  // console.log(dateRange)

  var data = 'var Data = {}; Data.MilestoneName = "' + milestone.name + '"; Data.LastFetched="' + moment().format('MMMM D, YYYY') + '"; ';
  console.log("Number of stories: " + stories.length)
  data += calculateStoryTypeData(stories, dateRange);
  data += calculateStoryRatioData(stories, dateRange);
  data += calculateMonthlyVelocityChartData(stories, dateRange);
  data += calculateCycleTimeChartData(stories, dateRange);
  data += calculateEstimateChartData(stories);

  fs.writeFileSync('data/milestone-' + milestone.id + '.js', data);
}

function saveMilestonesToFile(milestones) {
  var data = 'var ClubhouseMilestones = [];';
  _.each(_.filter(milestones, { completed: false }), function (milestone) {
    data += 'ClubhouseMilestones.push({ id: ' + milestone.id + ', name: "' + milestone.name + '" });';
  });
  _.each(_.filter(milestones, { completed: true }), function (milestone) {
    data += 'ClubhouseMilestones.push({ id: ' + milestone.id + ', name: "' + milestone.name + ' (completed)" });';
  });
  fs.writeFileSync(MILESTONE_FILE, data);
}

function fetchAndCompileChartForMilestone(milestone, callback) {
  callback = _.isFunction(callback) ? callback : _.noop;
  console.log('Fetching completed stories for milestone "' + milestone.name + '"...');

  fetchMilestoneEpics(milestone.id, function(err, res, epics){
    var epic = epics.shift();
    // TODO: Gotta implement a recursion just like line 255 and maybe paginate through stories

    if (epic) {
      console.log(epic.name)
      fetchCompletedStoriesForEpic(epic.name, function (err, res, stories) {
        compileChartData(stories.data, milestone);
        callback();
      });
    }
  });


}

function fetchAndCompileChartsForAllMilestones(milestones) {
  var milestone = milestones.shift();

  if (milestone) {
    fetchAndCompileChartForMilestone(milestone, function () {
      fetchAndCompileChartsForAllMilestones(milestones);
    });
  }
}

function findMatchingMilestones(milestones, query) {
  if (query === 'all') {
    return _.filter(milestones, { completed: false });
  }

  return _.filter(milestones, function (milestone) {
    return parseInt(query, 10) === milestone.id || milestone.name.toLowerCase().indexOf(query) === 0;
  });
}

function compileMilestoneData() {
  var query = process.argv[2];
  console.log('Fetching milestones...');

  fetchMilestones(function (err, res, milestones) {
    if (err || !milestones || milestones.length === 0) {
      console.log('No milestones found!');
      return false;
    }

    milestones = _.sortBy(milestones, 'name');
    saveMilestonesToFile(milestones);

   var foundMilestones = findMatchingMilestones(milestones, query);
   if (!query || foundMilestones.length === 0) {
     if (foundMilestones.length === 0) {
       console.log('Matching milestone not found!');
     }
     console.log('You have access to the following milestones:\n');
       milestones.forEach(function (milestone) {
       console.log('  - ' + milestone.name);
     });

     return false;
   }

   fetchAndCompileChartsForAllMilestones(foundMilestones);
  });
}

function displayNoTokenMessage() {
  console.log('Missing CLUBHOUSE_API_TOKEN environment variable.');
  console.log('If you don\'t already have one, go to Clubhouse > Settings > Your Account > API Tokens to create one.');
  console.log('Then run this command:');
  console.log('CLUBHOUSE_API_TOKEN="MYTOKEN"');
}

function init() {
  if (!TOKEN) {
    return displayNoTokenMessage();
  }

  compileMilestoneData();
}

init();
