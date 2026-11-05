# Goblins Takehome (original text, verbatim, received from Goblins)

Once teachers put Goblins in the hands of students, there is no going back. Our D90 retention is extremely high, as much as 82% for some cohorts, which is unprecedented across edtech. The tricky part is getting teachers to our point of activation: we need to get teachers over the friction of making the first assignment and giving kids access codes. We've gotten quite good at this, but we can always be better, and one way we can do so is to provide value to teachers outside of the product itself, via a "growth product".

This "growth product" is something we can give away generously that's still worth a teacher's time. It also should be valuable enough that it can build real habit on their own, and it should be discoverable and share-worthy, driving traffic to the main Goblins experience, which is a simple button-click away.

The bet: an **auto-grader**.

It's the same Goblins experience, still with the analytics, but with real-time feedback turned *off*. Teachers spend enormous amounts of time grading, and nothing like this exists in the market, so even with feedback off, we expect it to keep teachers coming back.

There's a catch. Grading runs the model on every submission, so at any real volume it costs money. That makes this two problems at once: a product one (how accurate is the auto grader w/ cheaper models?) and an infra one (can we trust it under load? and can we even test that without torching our model budget?).

## How the feature works

1. A teacher creates an assignment and shares it with students.
2. A grading rubric is generated for the assignment, and the teacher should be able to edit it.
3. Each student has a whiteboard available to show and submit their work.
4. After submitting a problem, the student is shown their score and continues to the next, until the assignment is complete.
5. The teacher receives a report showing each student's progress and grades.
6. Everything persists: a teacher (or student) can return on a different browser or device and find their data intact.

## Part 1: Product & Design (est. ~75 min)

Build the auto-grader as a working web app. You don't need to build *everything* described above (e.g. we don't need email auth for teachers!). You should decide the minimal slice worth shipping. Think: what's the least you can build to get this to a state a real teacher would enjoy using, while still inspiring the love of learning for students.

## Part 2: Infra, load-testing the grading pipeline (est. ~75 min)

Each grade is a model call, so it costs time and money. On testing day a class works through the assignment within the same window rather than all at once, so submissions arrive in spikes that the pipeline has to absorb.

Give us confidence that the grading pipeline holds up under that kind of spike, and let us re-run that check as often as we like.

By the end, we'd like to be able to:

- push a realistic testing-day load at the grading path and see how it behaves: where it slows down, where it breaks;
- run that test repeatedly and cheaply; and
- trust the results enough to make a ship / no-ship call.

What we care about most is the infra itself: can we deploy it and run a real load test against it, and is it solid? How you build it is your call, and the grading path you test against can be as simple as it needs to be.

Share the load-testing code and a very short writeup. Treat it less as a report than a statement of confidence: what the system can reliably handle as it stands, and what you'd do to take it to a higher scale (1,000 → 10,000 → 100,000 → 1M students).

## Tools

Use any AI coding tools you like (Claude Code, Cursor, v0, Lovable, and so on). We've put a $20 metered OpenRouter API key in your email for model calls. The time estimates assume you're working this way; without them, this will take a lot longer. And if there's a paid service you'd like to use that has no free tier, let us know and we'll cover it. Don't spend your own money.

We build in Effect (TypeScript), so we'd love to see it here if you're up for it. It's a preference, not a requirement, and no prior Effect experience is expected. The code is largely model-generated anyway, so a good agent will get you most of the way. If you go another route, that's fine.

## What we're evaluating

We're reading a few things at once. On the product and design side, we want to see your sense for what to build and what to leave out, and whether the result is something a teacher would enjoy using. On the technical side, we care less about a polished pipeline than about how you reason through scale, cost, and reliability, and how you take an open-ended goal and turn it into something concrete and working. Throughout, we're watching how you scope and prioritize under a tight time budget, and how clearly you explain the decisions you made and the ones you chose to defer.

Some parts of this brief are vague on purpose. Where the spec doesn't decide for you, we want to see the call you make and why. Feel free to reach out to Alp (alp@goblinsapp.com) anytime to clarify the product or business goal.

## Deliverable

- A publicly hosted web app.
- The repo, shared with Alp on GitHub (Karavil)
- *Optional:* a 2-3 minute screen recording walking through it.
