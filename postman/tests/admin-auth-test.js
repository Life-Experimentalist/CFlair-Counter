module.exports = function (runner, context, events, done) {
	// Runner will emit 'assertion' events we can use to record test results
	// This script assumes the collection has two requests in sequence for admin auth:
	// 1) POST /api/admin/stats with wrong password -> should return 401
	// 2) POST /api/admin/stats with correct password -> should return 200

	let stepIndex = 0;

	events.on("request", function (err, args) {
		stepIndex++;
	});

	events.on("assertion", function (err, item) {
		// noop here; we rely on response codes below
	});

	events.on("done", function (err, summary) {
		if (err) {
			return done(err);
		}
		// Check the run summary for assertions
		const executions = summary.run.executions || [];

		// Find executions by item name
		const findByName = (name) =>
			executions.find((e) => e.item && e.item.name === name);

		const wrongExec = findByName("Admin: Login (wrong) / Stats");
		const correctExec = findByName("Admin: Login / Stats");

		if (!wrongExec) {
			return done(
				new Error(
					"Could not find execution for Admin: Login (wrong) / Stats"
				)
			);
		}
		if (!correctExec) {
			return done(
				new Error("Could not find execution for Admin: Login / Stats")
			);
		}

		const wrongCode = wrongExec.response && wrongExec.response.code;
		const correctCode = correctExec.response && correctExec.response.code;

		if (wrongCode !== 401) {
			return done(
				new Error(
					"Expected wrong-password request to return 401, got " +
						wrongCode
				)
			);
		}
		if (correctCode !== 200) {
			return done(
				new Error(
					"Expected correct admin request to return 200, got " +
						correctCode
				)
			);
		}

		done();
	});
};
