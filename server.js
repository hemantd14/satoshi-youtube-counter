const express = require("express");
const path = require("path");

const app = express();

const PORT =
    process.env.PORT || 10000;


/* ========================================
   YOUTUBE CONFIGURATION
   ======================================== */

const YOUTUBE_API_KEY =
    process.env.YOUTUBE_API_KEY;

const YOUTUBE_CHANNEL_ID =
    process.env.YOUTUBE_CHANNEL_ID;

const YOUTUBE_VIDEO_ID =
    process.env.YOUTUBE_VIDEO_ID;


/* ========================================
   RAZORPAY - DISABLED
   ======================================== */

/*

const RAZORPAY_KEY_ID =
    process.env.RAZORPAY_KEY_ID;

const RAZORPAY_KEY_SECRET =
    process.env.RAZORPAY_KEY_SECRET;

const RAZORPAY_PAYMENT_LINK_ID =
    process.env.RAZORPAY_PAYMENT_LINK_ID;

*/


/* ========================================
   CACHE
   ======================================== */

let subscriberCache = {

    subscribers: 0,

    updatedAt: 0

};


let likeCache = {

    likes: 0,

    updatedAt: 0

};


/*
   YouTube API refresh interval.

   30 seconds is much safer than
   calling YouTube every second.
*/

const YOUTUBE_CACHE_TIME =
    30000;


/* ========================================
   LIKE SESSION
   ======================================== */

/*
   This is the like count when the current
   stream starts.

   Example:

   YouTube video starts with 42 likes.

   baseline = 42

   Current video = 47

   Stream likes = 47 - 42

   = 5
*/

let likeBaseline = null;


/* ========================================
   SUBSCRIBER GOAL
   ======================================== */

function calculateSubscriberGoal(
    subscribers
) {

    return (
        Math.floor(
            subscribers / 50
        ) + 1
    ) * 50;

}


/* ========================================
   LIKE GOAL
   ======================================== */

function calculateLikeGoal(
    likes
) {

    return (
        Math.floor(
            likes / 5
        ) + 1
    ) * 5;

}


/* ========================================
   HOME
   ======================================== */

app.get(
    "/",
    (req, res) => {

        res.json({

            status:
                "online",

            service:
                "Satoshi's Franchise YouTube Counter",

            features: [
                "YouTube subscribers",
                "Stream likes"
            ]

        });

    }
);


/* ========================================
   OBS OVERLAY
   ======================================== */

app.get(
    "/overlay",
    (req, res) => {

        res.sendFile(
            path.join(
                __dirname,
                "Sub counter.html"
            )
        );

    }
);


/* ========================================
   FETCH YOUTUBE SUBSCRIBERS
   ======================================== */

async function fetchSubscribers() {

    const url =
        "https://www.googleapis.com/youtube/v3/channels" +
        "?part=statistics" +
        "&id=" +
        encodeURIComponent(
            YOUTUBE_CHANNEL_ID
        ) +
        "&key=" +
        encodeURIComponent(
            YOUTUBE_API_KEY
        );


    const response =
        await fetch(url);


    const data =
        await response.json();


    if (!response.ok) {

        throw new Error(
            "YouTube subscriber API error"
        );

    }


    if (
        !data.items ||
        data.items.length === 0
    ) {

        throw new Error(
            "YouTube channel not found"
        );

    }


    return Number(
        data.items[0]
            .statistics
            .subscriberCount
    );

}


/* ========================================
   FETCH VIDEO LIKES
   ======================================== */

async function fetchVideoLikes() {

    if (!YOUTUBE_VIDEO_ID) {

        throw new Error(
            "YOUTUBE_VIDEO_ID is missing"
        );

    }


    const url =
        "https://www.googleapis.com/youtube/v3/videos" +
        "?part=statistics" +
        "&id=" +
        encodeURIComponent(
            YOUTUBE_VIDEO_ID
        ) +
        "&key=" +
        encodeURIComponent(
            YOUTUBE_API_KEY
        );


    const response =
        await fetch(url);


    const data =
        await response.json();


    if (!response.ok) {

        throw new Error(
            "YouTube video API error"
        );

    }


    if (
        !data.items ||
        data.items.length === 0
    ) {

        throw new Error(
            "YouTube video not found"
        );

    }


    return Number(
        data.items[0]
            .statistics
            .likeCount || 0
    );

}


/* ========================================
   REFRESH YOUTUBE CACHE
   ======================================== */

async function refreshYouTubeData() {

    try {

        if (
            !YOUTUBE_API_KEY ||
            !YOUTUBE_CHANNEL_ID
        ) {

            console.error(
                "YouTube environment variables missing"
            );

            return;

        }


        /* -------------------------------
           SUBSCRIBERS
           ------------------------------- */

        const subscribers =
            await fetchSubscribers();


        subscriberCache = {

            subscribers:
                subscribers,

            updatedAt:
                Date.now()

        };


        /* -------------------------------
           LIKES
           ------------------------------- */

        if (YOUTUBE_VIDEO_ID) {

            const totalLikes =
                await fetchVideoLikes();


            /*
               First request for a stream:

               baseline = current YouTube likes

               Therefore:

               streamLikes = 0
            */

            if (
                likeBaseline === null
            ) {

                likeBaseline =
                    totalLikes;

            }


            const streamLikes =
                Math.max(
                    0,
                    totalLikes -
                    likeBaseline
                );


            likeCache = {

                likes:
                    streamLikes,

                updatedAt:
                    Date.now()

            };

        }


    } catch (error) {

        console.error(
            "YouTube refresh error:",
            error
        );

    }

}


/* ========================================
   SUBSCRIBER API
   ======================================== */

app.get(
    "/api/youtube/subscribers",
    async (req, res) => {

        try {

            if (
                Date.now() -
                subscriberCache.updatedAt
                >=
                YOUTUBE_CACHE_TIME
            ) {

                await refreshYouTubeData();

            }


            const subscribers =
                subscriberCache.subscribers;


            res.json({

                subscribers:
                    subscribers,

                subscriberGoal:
                    calculateSubscriberGoal(
                        subscribers
                    ),

                updatedAt:
                    new Date()
                        .toISOString()

            });


        } catch (error) {

            console.error(error);


            res.status(500)
                .json({

                    error:
                        "Unable to get subscribers"

                });

        }

    }
);


/* ========================================
   LIKE API
   ======================================== */

app.get(
    "/api/youtube/likes",
    async (req, res) => {

        try {

            if (
                Date.now() -
                likeCache.updatedAt
                >=
                YOUTUBE_CACHE_TIME
            ) {

                await refreshYouTubeData();

            }


            const likes =
                likeCache.likes;


            res.json({

                likes:
                    likes,

                likeGoal:
                    calculateLikeGoal(
                        likes
                    ),

                updatedAt:
                    new Date()
                        .toISOString()

            });


        } catch (error) {

            console.error(error);


            res.status(500)
                .json({

                    error:
                        "Unable to get likes"

                });

        }

    }
);


/* ========================================
   RAZORPAY - DISABLED
   ======================================== */

/*

app.get(
    "/api/razorpay/total",
    async (req, res) => {

        // Razorpay code intentionally disabled.

    }
);

*/


/* ========================================
   START SERVER
   ======================================== */

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `Server running on port ${PORT}`
        );

    }
);