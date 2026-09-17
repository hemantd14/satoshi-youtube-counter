const express = require("express");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 10000;

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const YOUTUBE_CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID;


// ========================================
// HOME
// ========================================

app.get("/", (req, res) => {

    res.json({
        status: "online",
        service: "Satoshi's Franchise YouTube Counter"
    });

});


// ========================================
// OBS OVERLAY
// ========================================

app.get("/overlay", (req, res) => {

    res.sendFile(
        path.join(__dirname, "Sub counter.html")
    );

});


// ========================================
// YOUTUBE SUBSCRIBER API
// ========================================

app.get("/api/youtube/subscribers", async (req, res) => {

    try {

        if (!YOUTUBE_API_KEY || !YOUTUBE_CHANNEL_ID) {

            return res.status(500).json({
                error: "Server configuration missing"
            });

        }


        const url =
            "https://www.googleapis.com/youtube/v3/channels" +
            "?part=statistics" +
            "&id=" +
            encodeURIComponent(YOUTUBE_CHANNEL_ID) +
            "&key=" +
            encodeURIComponent(YOUTUBE_API_KEY);


        const response = await fetch(url);

        const data = await response.json();


        if (!response.ok) {

            console.error(
                "YouTube API error:",
                data
            );

            return res.status(500).json({
                error: "YouTube API request failed"
            });

        }


        if (!data.items || data.items.length === 0) {

            return res.status(404).json({
                error: "Channel not found"
            });

        }


        const statistics =
            data.items[0].statistics;


        res.json({

            subscribers:
                Number(statistics.subscriberCount),

            hidden:
                statistics.hiddenSubscriberCount || false,

            updatedAt:
                new Date().toISOString()

        });


    } catch (error) {

        console.error(
            "Server error:",
            error
        );


        res.status(500).json({
            error: "Internal server error"
        });

    }

});


// ========================================
// START SERVER
// ========================================

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `Server running on port ${PORT}`
        );

    }
);