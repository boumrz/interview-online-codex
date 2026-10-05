package com.interviewonline.controller

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.model.Room
import com.interviewonline.model.RoomParticipant
import com.interviewonline.model.RoomTask
import com.interviewonline.model.Team
import com.interviewonline.repository.*
import com.interviewonline.support.Postgres16TestSupport
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.annotation.DirtiesContext
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.patch
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.time.Instant
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@SpringBootTest
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class PersonalInterviewDetailsIntegrationTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val mapper: ObjectMapper,
    @Autowired private val users: UserRepository,
    @Autowired private val rooms: RoomRepository,
    @Autowired private val participants: RoomParticipantRepository,
    @Autowired private val teams: TeamRepository,
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired private val transactionManager: PlatformTransactionManager,
) {
    companion object {
        private val postgres=Postgres16TestSupport.create("personal_interview_details")
        @JvmStatic @DynamicPropertySource fun properties(registry: DynamicPropertyRegistry)=postgres.register(registry)
        @JvmStatic @AfterAll fun cleanup()=postgres.close()
    }

    @Test fun `personal summary returns compact ordered public task data and manager-only display names`() {
        postgres.verifyPostgres16()
        val fixture=fixture()
        for(account in listOf(fixture.owner,fixture.manager,fixture.candidate)) {
            val result=mvc.get("/api/me/rooms") { header("Authorization","Bearer ${account.token}") }.andReturn()
            assertEquals(200,result.response.status)
            val item=json(result).first { it.path("id").asText()==fixture.room.id }
            assertEquals(2,item.path("taskCount").asInt())
            assertEquals(listOf("First public task","Second public task"),item.path("tasks").map { it.path("title").asText() })
            assertEquals(listOf(0,1),item.path("tasks").map { it.path("stepIndex").asInt() })
            assertEquals("2026-10-05T09:00:00Z",item.path("finishedAt").asText())
            assertEquals(setOf("stepIndex","title","language","mandatory"),item.path("tasks").first().fieldNames().asSequence().toSet())
            val names=item.path("interviewerDisplayNames").map(JsonNode::asText)
            if(account==fixture.candidate) assertTrue(names.isEmpty()) else assertEquals(listOf("Owner name","Manager name"),names)
            for(field in listOf("candidateName","position","scheduledAt","code","notes","briefingMarkdown","privateNotesJson","accessMembers")) assertFalse(item.has(field),field)
            assertTrue(item.path("ownerToken").isNull); assertTrue(item.path("interviewerToken").isNull)
            assertFalse(result.response.contentAsString.contains("PRIVATE_SENTINEL"))
            assertEquals("private, no-store",result.response.getHeader("Cache-Control"))
        }
        val team=teams.saveAndFlush(Team(id=UUID.randomUUID().toString(),name="Team",normalizedName="team-${UUID.randomUUID()}",ownerUserId=fixture.owner.id))
        val teamRoom=rooms.saveAndFlush(Room(title="Team-only",inviteCode="team-${UUID.randomUUID()}",ownerSessionToken="private-owner",interviewerSessionToken="private-interviewer",ownerUser=users.findById(fixture.owner.id).orElseThrow(),teamId=team.id,originTeamId=team.id))
        val archived=rooms.saveAndFlush(Room(title="Archived-only",inviteCode="archive-${UUID.randomUUID()}",ownerSessionToken="private-owner",interviewerSessionToken="private-interviewer",ownerUser=users.findById(fixture.owner.id).orElseThrow(),archivedAt=Instant.now()))
        val ids=json(mvc.get("/api/me/rooms") { header("Authorization","Bearer ${fixture.owner.token}") }.andReturn()).map { it.path("id").asText() }
        assertFalse(ids.contains(teamRoom.id)); assertFalse(ids.contains(archived.id)); assertEquals(1,ids.count { it==fixture.room.id })
    }

    @Test fun `details reads are account authenticated personal manager only and expose exactly details`() {
        val fixture=fixture()
        for(account in listOf(fixture.owner,fixture.manager)) {
            val result=details(fixture,account)
            assertEquals(200,result.response.status)
            assertEquals(setOf("title","candidateName","position","scheduledAt","revision"),json(result).fieldNames().asSequence().toSet())
            assertEquals("PRIVATE_SENTINEL candidate",json(result).path("candidateName").asText())
            assertEquals("private, no-store",result.response.getHeader("Cache-Control"))
        }
        assertEquals(403,details(fixture,fixture.candidate).response.status)
        val outsider=register("outside")
        assertEquals(403,details(fixture,outsider).response.status)
        assertEquals(401,mvc.get("/api/me/rooms/${fixture.room.id}/details").andReturn().response.status)
        assertEquals(403,mvc.get("/api/me/rooms/${fixture.room.id}/details") {
            header("Authorization","Bearer ${fixture.candidate.token}"); header("X-Room-Owner-Token",fixture.room.ownerSessionToken)
        }.andReturn().response.status)
        assertEquals(404,mvc.get("/api/me/rooms/${UUID.randomUUID()}/details") { header("Authorization","Bearer ${fixture.owner.token}") }.andReturn().response.status)
    }

    @Test fun `owner combined save atomically changes normalized details and existing metadata endpoint revision`() {
        val fixture=fixture()
        val result=save(fixture,fixture.owner,body(" Changed title "," Candidate "," Position ","2026-10-06T12:00:00+03:00",0))
        assertEquals(200,result.response.status)
        assertEquals("Changed title",json(result).path("title").asText()); assertEquals("Candidate",json(result).path("candidateName").asText())
        assertEquals("Position",json(result).path("position").asText()); assertEquals("2026-10-06T09:00:00Z",json(result).path("scheduledAt").asText()); assertEquals(1,json(result).path("revision").asInt())
        val stored=rooms.findById(fixture.room.id!!).orElseThrow()
        assertEquals("Changed title",stored.title); assertEquals("Candidate",stored.candidateName); assertEquals("PRIVATE_SENTINEL code",stored.code)
        val legacy=mvc.get("/api/rooms/${fixture.room.inviteCode}/interview-metadata") { header("Authorization","Bearer ${fixture.manager.token}") }.andReturn()
        assertEquals(200,legacy.response.status); assertEquals(1,json(legacy).path("revision").asInt()); assertEquals("Candidate",json(legacy).path("candidateName").asText())
        assertEquals("private, no-store",result.response.getHeader("Cache-Control"))
    }

    @Test fun `interviewer edits metadata with unchanged title but never renames and candidate cannot write`() {
        val fixture=fixture()
        val ownerTitle=fixture.room.title
        assertEquals(403,save(fixture,fixture.manager,body("Unauthorized title",revision=0)).response.status)
        assertEquals(ownerTitle,rooms.findById(fixture.room.id!!).orElseThrow().title)
        assertEquals(0,rooms.findById(fixture.room.id!!).orElseThrow().interviewMetadataRevision)
        val result=save(fixture,fixture.manager,body(ownerTitle,candidate=" Manager candidate ",revision=0))
        assertEquals(200,result.response.status); assertEquals("Manager candidate",json(result).path("candidateName").asText())
        assertEquals(403,save(fixture,fixture.candidate,body(ownerTitle,revision=1)).response.status)
        assertEquals(403,save(fixture,register("foreign"),body(ownerTitle,revision=1)).response.status)
        assertEquals(1,rooms.findById(fixture.room.id!!).orElseThrow().interviewMetadataRevision)
    }

    @Test fun `invalid combined fields never partially rename or change metadata and missing or extra keys reject`() {
        val fixture=fixture()
        val original=body(fixture.room.title,"PRIVATE_SENTINEL candidate","PRIVATE_SENTINEL position","2026-10-05T08:00:00Z",0)
        val invalid=listOf(
            body("   "), body("x".repeat(256)),body("New",candidate="x".repeat(201)),body("New",position="x".repeat(201)),
            body("New",scheduled="2026-10-06T12:00:00"),body("New",revision=-1),body("New").minus("position"),
            body("New")+mapOf("unexpected" to "field"),body("New")+mapOf("revision" to "0"),body("New")+mapOf("candidateName" to 42),body("New")+mapOf("title" to null),
        )
        invalid.forEach { request -> assertEquals(400,save(fixture,fixture.owner,request).response.status) }
        assertEquals(original,json(details(fixture,fixture.owner)).fields().asSequence().associate { it.key to when { it.value.isNull -> null; it.value.isIntegralNumber -> it.value.asLong(); else -> it.value.asText() } })
        val cleared=save(fixture,fixture.owner,body(fixture.room.title,candidate=" ",position=null,scheduled=null))
        assertEquals(200,cleared.response.status); assertTrue(json(cleared).path("candidateName").isNull); assertTrue(json(cleared).path("position").isNull); assertTrue(json(cleared).path("scheduledAt").isNull)
    }

    @Test fun `same revision concurrent edits produce one complete tuple and one conflict without mixed data`() {
        val fixture=fixture()
        val executor=Executors.newFixedThreadPool(2); val start=CountDownLatch(1)
        val bodies=listOf(body("Title A","Candidate A","Position A",revision=0),body("Title B","Candidate B","Position B",revision=0))
        try {
            val futures=bodies.map { request -> executor.submit<MvcResult> { start.await(); save(fixture,fixture.owner,request) } }
            start.countDown(); val results=futures.map { it.get(10,TimeUnit.SECONDS) }
            assertEquals(listOf(200,409),results.map { it.response.status }.sorted())
            val winning=bodies[results.indexOfFirst { it.response.status==200 }]
            val stored=rooms.findById(fixture.room.id!!).orElseThrow()
            assertEquals(winning["title"],stored.title); assertEquals(winning["candidateName"],stored.candidateName); assertEquals(winning["position"],stored.position); assertEquals(1,stored.interviewMetadataRevision)
        } finally { executor.shutdownNow() }
    }

    @Test fun `legacy title-only rename bumps details revision and stale unified save cannot overwrite it`() {
        val fixture=fixture()
        val renamed=mvc.patch("/api/me/rooms/${fixture.room.id}") { header("Authorization","Bearer ${fixture.owner.token}"); contentType=MediaType.APPLICATION_JSON; content="{\"title\":\"Legacy renamed\"}" }.andReturn()
        assertEquals(200,renamed.response.status)
        assertEquals(1,rooms.findById(fixture.room.id!!).orElseThrow().interviewMetadataRevision)
        assertEquals(409,save(fixture,fixture.owner,body("Stale title",candidate="Stale candidate",revision=0)).response.status)
        assertEquals("Legacy renamed",rooms.findById(fixture.room.id!!).orElseThrow().title)
        assertEquals("PRIVATE_SENTINEL candidate",rooms.findById(fixture.room.id!!).orElseThrow().candidateName)
    }

    @Test fun `manager authority is reread after room row lock wait and removed role cannot save`() {
        val fixture=fixture()
        val executor=Executors.newSingleThreadExecutor()
        lateinit var result:java.util.concurrent.Future<MvcResult>
        try {
            TransactionTemplate(transactionManager).executeWithoutResult {
                rooms.lockById(fixture.room.id!!)
                participants.deleteByRoomIdAndUserId(fixture.room.id!!,fixture.manager.id)
                participants.flush()
                result=executor.submit<MvcResult> { save(fixture,fixture.manager,body(fixture.room.title,candidate="Revoked write",revision=0)) }
                val deadline=System.nanoTime()+2_000_000_000L
                var blocked=false
                while(System.nanoTime()<deadline && !result.isDone) {
                    blocked=(jdbc.queryForObject("SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND pid IN (SELECT pid FROM pg_locks WHERE relation='rooms'::regclass)",Long::class.java) ?: 0)>0
                    if(blocked) break
                    Thread.sleep(20)
                }
                assertTrue(blocked,"request must reach the room lock")
            }
            assertEquals(403,result.get(10,TimeUnit.SECONDS).response.status)
            assertEquals("PRIVATE_SENTINEL candidate",rooms.findById(fixture.room.id!!).orElseThrow().candidateName)
            assertEquals(0,rooms.findById(fixture.room.id!!).orElseThrow().interviewMetadataRevision)
        } finally { executor.shutdownNow() }
    }

    @Test fun `personal details rejects team and archived rooms without mutation`() {
        val fixture=fixture()
        val team=teams.saveAndFlush(Team(id=UUID.randomUUID().toString(),name="Team",normalizedName="scope-${UUID.randomUUID()}",ownerUserId=fixture.owner.id))
        fixture.room.teamId=team.id; fixture.room.originTeamId=team.id; rooms.saveAndFlush(fixture.room)
        assertEquals(404,details(fixture,fixture.owner).response.status); assertEquals(404,save(fixture,fixture.owner,body("Team write")).response.status)
        fixture.room.teamId=null; fixture.room.originTeamId=null; fixture.room.archivedAt=Instant.now(); rooms.saveAndFlush(fixture.room)
        assertEquals(410,details(fixture,fixture.owner).response.status); assertEquals(410,save(fixture,fixture.owner,body("Archived write")).response.status)
        assertEquals(fixture.room.title,rooms.findById(fixture.room.id!!).orElseThrow().title)
    }

    private data class Fixture(val owner:HrTestAccount,val manager:HrTestAccount,val candidate:HrTestAccount,val room:Room)
    private fun fixture():Fixture {
        val owner=register("owner"); val manager=register("manager"); val candidate=register("candidate")
        val ownerUser=users.findById(owner.id).orElseThrow().apply { displayName="Owner name" }; users.saveAndFlush(ownerUser)
        val managerUser=users.findById(manager.id).orElseThrow().apply { displayName="Manager name" }; users.saveAndFlush(managerUser)
        val room=Room(title="Personal title",inviteCode="personal-${UUID.randomUUID()}",ownerSessionToken="PRIVATE_SENTINEL owner",interviewerSessionToken="PRIVATE_SENTINEL interviewer",ownerUser=ownerUser,code="PRIVATE_SENTINEL code",notes="PRIVATE_SENTINEL notes",privateNotesJson="PRIVATE_SENTINEL notes",briefingMarkdown="PRIVATE_SENTINEL briefing",candidateName="PRIVATE_SENTINEL candidate",position="PRIVATE_SENTINEL position",scheduledAt=Instant.parse("2026-10-05T08:00:00Z"),finishedAt=Instant.parse("2026-10-05T09:00:00Z"),status="finished")
        room.tasks=mutableListOf(RoomTask(room=room,stepIndex=1,title="Second public task",language="kotlin",description="PRIVATE_SENTINEL description",starterCode="PRIVATE_SENTINEL starter",privateNotesJson="PRIVATE_SENTINEL notes"),RoomTask(room=room,stepIndex=0,title="First public task",language="nodejs",mandatory=true,description="PRIVATE_SENTINEL description",starterCode="PRIVATE_SENTINEL starter",workspaceYjsDocumentBase64="PRIVATE_SENTINEL document"))
        val saved=rooms.saveAndFlush(room)
        participants.saveAndFlush(RoomParticipant(room=saved,user=managerUser,role="interviewer"))
        participants.saveAndFlush(RoomParticipant(room=saved,user=users.findById(candidate.id).orElseThrow(),role="candidate"))
        return Fixture(owner,manager,candidate,saved)
    }
    private fun register(prefix:String)=HrHttpFixtures.register(mvc,mapper,false,"personal-$prefix").first
    private fun details(fixture:Fixture,account:HrTestAccount)=mvc.get("/api/me/rooms/${fixture.room.id}/details") { header("Authorization","Bearer ${account.token}") }.andReturn()
    private fun save(fixture:Fixture,account:HrTestAccount,body:Map<String,Any?>)=mvc.patch("/api/me/rooms/${fixture.room.id}/details") { header("Authorization","Bearer ${account.token}"); contentType=MediaType.APPLICATION_JSON; content=mapper.writeValueAsString(body) }.andReturn()
    private fun body(title:String,candidate:String?="Candidate",position:String?="Position",scheduled:String?=null,revision:Long=0):Map<String,Any?> = mapOf("title" to title,"candidateName" to candidate,"position" to position,"scheduledAt" to scheduled,"revision" to revision)
    private fun json(result:MvcResult)=mapper.readTree(result.response.contentAsByteArray)
}
