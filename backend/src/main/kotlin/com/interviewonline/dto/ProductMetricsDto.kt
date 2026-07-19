package com.interviewonline.dto

data class ProductMetricsResponse(
    val source: String,
    val availability: String,
    val range: ProductMetricsRangeDto,
    val metadata: ProductMetricsMetadataDto,
    val funnel: ProductMetricsFunnelDto?,
    val interviewers: ProductMetricsInterviewersDto?,
    val reliability: ProductMetricsReliabilityDto?,
    val daily: List<ProductMetricsDailyDto>,
)

data class ProductMetricsRangeDto(
    val start: String,
    val end: String,
    val timezone: String,
)

data class ProductMetricsMetadataDto(
    val collectionStartedAt: String?,
    val freshThrough: String,
    val reason: String? = null,
)

data class ProductMetricsFunnelDto(
    val roomsCreated: Int,
    val preparedRooms: Int,
    val candidateAttendance: Int,
    val interviewsStarted: Int,
    val meaningfulCandidateActivity: Int,
    val firstVerdictsSaved: Int,
    val decisionReadyTechnicalInterviews: Int,
    val candidateAttendanceRate: Double?,
    val meaningfulActivityRate: Double?,
    val verdictCompletionRate: Double?,
    val decisionReadyRate: Double?,
    val medianMinutesToCandidateJoin: Long?,
    val medianMinutesToDecision: Long?,
)

data class ProductMetricsInterviewersDto(
    val activeAuthenticatedInterviewers: Int,
    val newlyActivatedInterviewers: Int,
    val repeatUseInterviewers: Int,
    val activationRate: Double?,
    val repeatUseRate: Double?,
)

data class ProductMetricsReliabilityDto(
    val roomsWithRealtimeConnections: Int,
    val totalRealtimeConnections: Int,
    val additionalConnectionsAfterFirst: Int,
    val roomsWithCandidateAttendance: Int,
)

data class ProductMetricsDailyDto(
    val date: String,
    val roomsCreated: Int,
    val candidateAttendance: Int,
    val meaningfulCandidateActivity: Int,
    val firstVerdictsSaved: Int,
    val decisionReadyTechnicalInterviews: Int,
)
