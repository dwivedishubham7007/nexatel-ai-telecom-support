// ==========================================================
// DASHBOARD.JS
// ==========================================================
//
// INTERNAL SUPPORT DASHBOARD LOGIC
//
// This page is different from customer UI.
//
// Agents can see:
//
// - priority
// - confidence
// - escalation
// - ticket volume
// - categories
//
// Data comes from:
//
// GET /analytics
//
// GET /tickets
//
// ==========================================================


// ==========================================================
// FASTAPI ADDRESS
// ==========================================================

const API_URL =
    "http://127.0.0.1:8000";


// ==========================================================
// LOAD DASHBOARD
// ==========================================================

async function loadDashboard() {


    try {


        // --------------------------------------------------
        // REQUEST TWO ENDPOINTS TOGETHER
        // --------------------------------------------------
        //
        // Promise.all runs both calls in parallel.
        //

        const [

            analyticsResponse,

            ticketsResponse

        ] = await Promise.all([


            fetch(
                `${API_URL}/analytics`
            ),


            fetch(
                `${API_URL}/tickets`
            )


        ]);


        // --------------------------------------------------
        // CHECK REQUEST SUCCESS
        // --------------------------------------------------

        if (
            !analyticsResponse.ok
            ||
            !ticketsResponse.ok
        ) {

            throw new Error(
                "Dashboard API request failed"
            );

        }


        // --------------------------------------------------
        // CONVERT RESPONSES TO JS OBJECTS
        // --------------------------------------------------

        const analytics =
            await analyticsResponse.json();


        const ticketData =
            await ticketsResponse.json();


        // --------------------------------------------------
        // UPDATE UI
        // --------------------------------------------------

        updateStatistics(
            analytics
        );


        updateCategories(
            analytics.categories
        );


        updateTicketTable(
            ticketData.tickets
        );


    }

    catch (
        error
    ) {


        console.error(

            "Dashboard loading error:",

            error

        );

    }

}


// ==========================================================
// KPI CARDS
// ==========================================================

function updateStatistics(
    analytics
) {


    // Total tickets
    document
        .getElementById(
            "totalTickets"
        )
        .textContent =

            analytics.total_tickets;


    // Escalated tickets
    document
        .getElementById(
            "escalatedTickets"
        )
        .textContent =

            analytics.escalated_tickets;


    // Escalation rate
    document
        .getElementById(
            "escalationRate"
        )
        .textContent =

            analytics
                .escalation_rate_percent

            + "%";


    // Critical tickets
    const criticalCount =

        analytics
            .priorities
            ?.Critical

        || 0;


    document
        .getElementById(
            "criticalTickets"
        )
        .textContent =

            criticalCount;

}


// ==========================================================
// CATEGORY BREAKDOWN
// ==========================================================

function updateCategories(
    categories
) {


    const container =
        document.getElementById(
            "categoryStats"
        );


    // Remove old cards.
    container.innerHTML =
        "";


    // Example input:
    //
    // {
    //   Network: 5,
    //   Billing: 2
    // }

    Object.entries(
        categories
    ).forEach(


        ([
            category,
            count
        ]) => {


            // Create card.
            const card =
                document.createElement(
                    "div"
                );


            card.className =
                "stat-card";


            // Insert values.
            card.innerHTML = `

                <span>
                    ${escapeHtml(category)}
                </span>

                <strong>
                    ${count}
                </strong>

            `;


            container.appendChild(
                card
            );

        }

    );

}


// ==========================================================
// TICKET TABLE
// ==========================================================

function updateTicketTable(
    tickets
) {


    const table =
        document.getElementById(
            "ticketTable"
        );


    // Clear previous table.
    table.innerHTML =
        "";


    // ------------------------------------------------------
    // EMPTY STATE
    // ------------------------------------------------------

    if (
        tickets.length === 0
    ) {


        const row =
            document.createElement(
                "tr"
            );


        row.innerHTML = `

            <td colspan="7">
                No support tickets yet.
            </td>

        `;


        table.appendChild(
            row
        );


        return;

    }


    // ------------------------------------------------------
    // CREATE TABLE ROWS
    // ------------------------------------------------------

    tickets.forEach(

        ticket => {


            const row =
                document.createElement(
                    "tr"
                );


            // Determine priority badge CSS.
            const priorityClass =
                getPriorityClass(
                    ticket.priority
                );


            // Convert database timestamp.
            const createdDate =
                new Date(
                    ticket.created_at
                );


            // Build table row.
            row.innerHTML = `


                <td>

                    <strong>

                        ${escapeHtml(
                            ticket.ticket_id
                        )}

                    </strong>

                </td>


                <td>

                    ${escapeHtml(
                        ticket.category
                    )}

                </td>


                <td>

                    <span
                        class="
                            badge
                            ${priorityClass}
                        "
                    >

                        ${escapeHtml(
                            ticket.priority
                        )}

                    </span>

                </td>


                <td>

                    ${
                        Math.round(

                            ticket.confidence
                            * 100

                        )
                    }%

                </td>


                <td>

                    ${
                        ticket.escalated
                            ? "Yes"
                            : "No"
                    }

                </td>


                <td>

                    ${escapeHtml(
                        ticket.message
                    )}

                </td>


                <td>

                    ${createdDate.toLocaleString()}

                </td>


            `;


            table.appendChild(
                row
            );

        }

    );

}


// ==========================================================
// PRIORITY COLOR MAPPING
// ==========================================================

function getPriorityClass(
    priority
) {


    switch (
        priority
    ) {


        case "Critical":

            return "badge-critical";


        case "High":

            return "badge-high";


        case "Medium":

            return "badge-medium";


        default:

            return "badge-low";

    }

}


// ==========================================================
// SAFE HTML OUTPUT
// ==========================================================
//
// Prevents text from being treated as HTML.
//

function escapeHtml(
    text
) {


    const temporary =
        document.createElement(
            "div"
        );


    temporary.textContent =
        text ?? "";


    return temporary.innerHTML;

}


// ==========================================================
// INITIAL PAGE LOAD
// ==========================================================
//
// Immediately load dashboard once page opens.
//

loadDashboard();


// ==========================================================
// AUTOMATIC REFRESH
// ==========================================================
//
// Every 15 seconds:
// refresh analytics + ticket list.
//
// Later this can be replaced by:
//
// WebSockets
//
// or Server-Sent Events.
//

setInterval(

    loadDashboard,

    15000

);